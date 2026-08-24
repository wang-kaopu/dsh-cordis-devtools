import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright'

const DSH_PACKAGE = '@deepseek-ai/dsh@0.1.1-rc.2'
const DUPLICATE_EVENT = 'cordis-devtools-e2e/duplicate-listener'
const DUPLICATE_FIBER_NAME = 'cordis-devtools-e2e-duplicate-plugin'
const repoRoot = process.cwd()
const probeRoot = join(repoRoot, 'e2e', 'fixtures', 'waterfall-probe')
const agentDebuggingProbeRoot = join(repoRoot, 'e2e', 'fixtures', 'agent-debugging-probe')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const dshHome = await mkdtemp(join(tmpdir(), 'dsh-cordis-devtools-e2e-'))
const port = await getFreePort()
const mcpPort = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`
const mcpPatch = join(dshHome, 'cordis-devtools-mcp.patch.yml')
const env = {
  ...process.env,
  CI: '1',
  DSH_HOME: dshHome,
}

let server
let browser
let mcpClient
let serverOutput = ''

try {
  await run(pnpm, [
    'dlx', DSH_PACKAGE,
    'plugin', '--profile', 'web', 'add', repoRoot,
  ], { env })
  await run(pnpm, [
    'dlx', DSH_PACKAGE,
    'plugin', '--profile', 'web', 'add', probeRoot,
  ], { env })
  await run(pnpm, [
    'dlx', DSH_PACKAGE,
    'plugin', '--profile', 'web', 'add', agentDebuggingProbeRoot,
  ], { env })
  await writeFile(mcpPatch, [
    '- id: dsh-cordis-devtools',
    '  config:',
    '    mcp:',
    '      enabled: true',
    `      port: ${mcpPort}`,
    '',
  ].join('\n'))

  server = spawn(pnpm, [
    'dlx', DSH_PACKAGE,
    'web', '--patch', mcpPatch,
    '--no-open', '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const appendServerOutput = (chunk) => {
    serverOutput += chunk.toString()
    if (serverOutput.length > 30_000) serverOutput = serverOutput.slice(-30_000)
  }
  server.stdout.on('data', appendServerOutput)
  server.stderr.on('data', appendServerOutput)

  await waitForServer(baseUrl, server)
  await waitForPort(mcpPort, server)

  mcpClient = new Client({ name: 'dsh-cordis-devtools-real-dsh-e2e', version: '1.0.0' })
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)))
  const mcpTools = await mcpClient.listTools()
  assert.deepEqual(mcpTools.tools.map(tool => tool.name), [
    'cordis_runtime_summary',
    'cordis_inspect_event',
    'cordis_inspect_fiber',
    'cordis_search_dispatches',
    'cordis_profiler_traces',
  ])
  const mcpSummary = await mcpClient.callTool({ name: 'cordis_runtime_summary', arguments: {} })
  assert.equal(mcpSummary.isError, undefined)
  assert.equal(mcpSummary.structuredContent?.dispatchWindow?.bounded, true)
  assert.equal(mcpSummary.structuredContent?.profiler?.instrumentation, 'disabled')

  const duplicateEvidence = await waitForDuplicateEvidence(mcpClient)
  assert.equal(duplicateEvidence.event.listenerCount, 2)
  assert.equal(duplicateEvidence.ownerUids.length, 2)
  assert.equal(new Set(duplicateEvidence.ownerUids).size, 2)
  assert.equal(duplicateEvidence.byName.matches.length, 2)
  assert.equal(duplicateEvidence.dispatches.window.bounded, true)
  assert.ok(duplicateEvidence.dispatches.records.length >= 1)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await completeBlockingOnboarding(page)

  const trigger = page.locator('[data-testid="cordis-devtools-trigger"]')
  await trigger.waitFor({ state: 'visible', timeout: 30_000 })
  await trigger.click()

  const panel = page.locator('[data-testid="cordis-devtools-panel"]')
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(() => {
    const value = document.querySelector('[data-testid="cordis-devtools-panel"]')?.textContent ?? ''
    return /\d+ events · \d+ listeners/.test(value)
  }, undefined, { timeout: 15_000 })

  const panelText = await panel.textContent()
  assert.match(panelText ?? '', /Events/)
  assert.match(panelText ?? '', /Timeline/)
  assert.match(panelText ?? '', /Fibers/)
  assert.match(panelText ?? '', /Profiler/)
  assert.equal(await page.locator('[data-testid="cordis-devtools-error"]').count(), 0)

  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  assert.match(await panel.textContent() ?? '', /recent dispatches/i)

  await page.getByRole('button', { name: 'Fibers', exact: true }).click()
  const fiberDetail = page.locator('[data-testid="cordis-devtools-fiber-detail"]')
  await fiberDetail.waitFor({ state: 'visible', timeout: 10_000 })
  assert.match(await fiberDetail.textContent() ?? '', /Effects/)

  await page.getByRole('button', { name: 'Profiler', exact: true }).click()
  await page.getByRole('region', { name: 'Waterfall Profiler' }).waitFor({ state: 'visible', timeout: 10_000 })
  const profilerToggle = page.locator('[data-testid="cordis-devtools-profiler-toggle"]')
  await profilerToggle.waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal(await profilerToggle.textContent(), 'Enable profiling')

  await profilerToggle.click()
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Disable profiling'
  }, undefined, { timeout: 10_000 })

  const probeTrace = panel.locator('[data-trace-id]')
    .filter({ hasText: 'cordis-devtools-e2e/probe' })
    .first()
  await probeTrace.waitFor({ state: 'visible', timeout: 15_000 })
  await probeTrace.locator('[data-disclosure-row]').click()
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-trace-id]')]
    const probe = rows.find(row => row.textContent?.includes('cordis-devtools-e2e/probe'))
    return probe?.textContent?.includes('next #1') === true
  }, undefined, { timeout: 10_000 })
  const probeText = await probeTrace.textContent()
  assert.match(probeText ?? '', /cordis-devtools-e2e\/probe/)
  assert.match(probeText ?? '', /next #1/)

  await profilerToggle.click()
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Enable profiling'
  }, undefined, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Close Cordis DevTools' }).click()
  await panel.waitFor({ state: 'detached', timeout: 10_000 })

  assert.deepEqual(pageErrors, [], `browser page errors:\n${pageErrors.map(String).join('\n')}`)
  console.log(`DSH Web + external MCP duplicate-fiber smoke passed at ${baseUrl} / ${mcpUrl}`)
} catch (error) {
  if (serverOutput.length > 0) {
    console.error('\n--- dsh web output ---\n' + serverOutput + '\n--- end dsh web output ---')
  }
  throw error
} finally {
  await mcpClient?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await stop(server)
  await rm(dshHome, { recursive: true, force: true })
}

async function waitForDuplicateEvidence(client) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const eventResult = await client.callTool({
      name: 'cordis_inspect_event',
      arguments: { name: DUPLICATE_EVENT },
    })
    const event = eventResult.structuredContent
    const ownerUids = event?.listeners
      ?.filter(listener => listener.ownerLive === true && listener.owner?.uid != null)
      .map(listener => listener.owner.uid) ?? []
    const uniqueOwnerUids = [...new Set(ownerUids)]

    if (event?.found === true && event.listenerCount === 2 && uniqueOwnerUids.length === 2) {
      const byNameResult = await client.callTool({
        name: 'cordis_inspect_fiber',
        arguments: { name: DUPLICATE_FIBER_NAME },
      })
      const byName = byNameResult.structuredContent
      const fibersMatch = byName?.matches?.length === 2
        && uniqueOwnerUids.every(uid => byName.matches.some(fiber => fiber.uid === uid))

      let uidDetailsMatch = fibersMatch
      if (uidDetailsMatch) {
        for (const uid of uniqueOwnerUids) {
          const byUidResult = await client.callTool({
            name: 'cordis_inspect_fiber',
            arguments: { uid },
          })
          const byUid = byUidResult.structuredContent
          if (
            byUid?.matches?.length !== 1
            || byUid.matches[0].uid !== uid
            || !byUid.matches[0].ownedEvents?.includes(DUPLICATE_EVENT)
          ) {
            uidDetailsMatch = false
            break
          }
        }
      }

      if (uidDetailsMatch) {
        const dispatchResult = await client.callTool({
          name: 'cordis_search_dispatches',
          arguments: { event: DUPLICATE_EVENT, limit: 20 },
        })
        const dispatches = dispatchResult.structuredContent
        if (
          dispatches?.window?.bounded === true
          && dispatches.records?.some(record => uniqueOwnerUids.includes(record.thisFiber?.uid))
        ) {
          return { event, ownerUids: uniqueOwnerUids, byName, dispatches }
        }
      }
    }

    await delay(100)
  }
  throw new Error('timed out waiting for duplicate-Fiber evidence through MCP')
}

async function completeBlockingOnboarding(page) {
  const welcome = page.getByRole('dialog', { name: /Internal Testing Notice|内测声明/ }).first()
  const welcomeAppeared = await welcome.waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true, () => false)
  if (welcomeAppeared) {
    await welcome.getByRole('button', { name: /^(Continue|继续)$/ }).click()
    await welcome.waitFor({ state: 'hidden', timeout: 15_000 })
  }

  const credential = page.getByRole('dialog', {
    name: /Add an API key to get started|添加一个 API Key 开始使用/,
  }).first()
  const credentialAppeared = await credential.waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true, () => false)
  if (credentialAppeared) {
    await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/ }).click()
    await credential.waitFor({ state: 'hidden', timeout: 15_000 })
  }
}

async function getFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  const selected = address.port
  await new Promise(resolve => server.close(resolve))
  return selected
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh web exited before becoming ready (code ${child.exitCode})`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // startup race
    }
    await delay(250)
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function waitForPort(targetPort, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh web exited before MCP became reachable (code ${child.exitCode})`)
    }
    const reachable = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port: targetPort })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
    if (reachable) return
    await delay(100)
  }
  throw new Error(`timed out waiting for MCP port ${targetPort}`)
}

async function run(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error([
        `${command} ${args.join(' ')} failed with code ${code}`,
        stdout,
        stderr,
      ].filter(Boolean).join('\n')))
    })
  })
}

async function stop(child) {
  if (child === undefined || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && child.exitCode === null) child.kill('SIGKILL')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
