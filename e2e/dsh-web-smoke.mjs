import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright'

const DSH_PACKAGE = '@deepseek-ai/dsh@0.1.1-rc.2'
const DUPLICATE_EVENT = 'cordis-devtools-e2e/duplicate-listener'
const VERIFICATION_EVENT = 'cordis-devtools-e2e/runtime-verification-duplicate'
const VERIFICATION_FIBER_NAME = 'cordis-devtools-e2e-runtime-verification-plugin'
const VERIFICATION_TRANSITION_FILENAME = 'cordis-devtools-e2e-runtime-verification-transition'
const VERIFICATION_INSPECT_RESULT_FILENAME = 'cordis-devtools-e2e-runtime-verification-inspect-result.json'
const repoRoot = process.cwd()
const probeRoot = join(repoRoot, 'e2e', 'fixtures', 'waterfall-probe')
const agentDebuggingProbeRoot = join(repoRoot, 'e2e', 'fixtures', 'agent-debugging-probe')
const runtimeVerificationProbeRoot = join(repoRoot, 'e2e', 'fixtures', 'runtime-verification-probe')
const inspectProbeRoot = join(repoRoot, 'e2e', 'fixtures', 'cordis-inspect-probe')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const dshHome = await mkdtemp(join(tmpdir(), 'dsh-cordis-devtools-e2e-'))
const port = await getFreePort()
const mcpPort = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`
const mcpPatch = join(dshHome, 'cordis-devtools-mcp.patch.yml')
const verificationTransitionFile = join(dshHome, VERIFICATION_TRANSITION_FILENAME)
const verificationInspectResultFile = join(dshHome, VERIFICATION_INSPECT_RESULT_FILENAME)
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
  await run(pnpm, [
    'dlx', DSH_PACKAGE,
    'plugin', '--profile', 'web', 'add', runtimeVerificationProbeRoot,
  ], { env })
  await run(pnpm, [
    'dlx', DSH_PACKAGE,
    'plugin', '--profile', 'web', 'add', inspectProbeRoot,
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
  await waitForOutput('[cordis-devtools-e2e] CordisRuntime duplicate-fiber inspect OK', server)
  await waitForOutput('[cordis-devtools-e2e] runtime verification baseline ready:', server)
  await waitForOutput('[cordis-devtools-e2e] CordisRuntime verification baseline captured', server)
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
    'cordis_capture_checkpoint',
    'cordis_compare_current',
    'cordis_list_debug_targets',
    'cordis_attach_debug_session',
    'cordis_debug_snapshot',
    'cordis_wait_for_runtime_change',
    'cordis_detach_debug_session',
  ])

  const targetsResult = await mcpClient.callTool({
    name: 'cordis_list_debug_targets',
    arguments: {},
  })
  assert.notEqual(targetsResult.isError, true)
  const target = targetsResult.structuredContent?.targets?.find(candidate => (
    candidate.type === 'cordis-runtime' && candidate.status === 'active'
  ))
  assert.ok(target, 'missing active cordis-runtime Agent Debug target')
  assert.equal(typeof target.targetId, 'string')
  assert.equal(typeof target.targetEpoch, 'number')
  assert.equal(typeof target.metadata?.title, 'string')
  assert.ok(Array.isArray(target.capabilities))

  const attachResult = await mcpClient.callTool({
    name: 'cordis_attach_debug_session',
    arguments: { targetId: target.targetId },
  })
  assert.notEqual(attachResult.isError, true)
  const debugSession = attachResult.structuredContent
  assert.equal(typeof debugSession?.debugSessionId, 'string')
  assert.equal(debugSession?.targetId, target.targetId)
  assert.equal(debugSession?.status, 'active')

  const debugSnapshotResult = await mcpClient.callTool({
    name: 'cordis_debug_snapshot',
    arguments: {
      debugSessionId: debugSession.debugSessionId,
      sections: ['summary', 'events', 'fibers', 'dispatches', 'profiler', 'candidates'],
      catalogs: {
        events: { limit: 5 },
        fibers: { limit: 5 },
        dispatches: { limit: 5 },
        candidates: { limit: 5 },
      },
    },
  })
  assert.notEqual(debugSnapshotResult.isError, true)
  const debugSnapshot = debugSnapshotResult.structuredContent
  assert.equal(debugSnapshot?.target?.targetId, target.targetId)
  assert.equal(debugSnapshot?.session?.debugSessionId, debugSession.debugSessionId)
  assert.equal(debugSnapshot?.session?.status, 'active')
  assert.equal(debugSnapshot?.summary?.events > 0, true)
  assert.equal(debugSnapshot?.summary?.liveFibers > 0, true)
  for (const section of ['events', 'fibers', 'dispatches', 'candidates']) {
    assert.equal(debugSnapshot?.[section]?.window?.bounded, true, `${section} catalog is not bounded`)
    assert.ok(debugSnapshot?.[section]?.window?.limit <= 5, `${section} catalog exceeded requested bound`)
    assert.ok(Array.isArray(debugSnapshot?.[section]?.items), `${section} catalog has no items array`)
  }

  const debugWaitResult = await mcpClient.callTool({
    name: 'cordis_wait_for_runtime_change',
    arguments: {
      debugSessionId: debugSession.debugSessionId,
      afterSequence: debugSnapshot.session.observationSequence,
      type: 'dispatch-observed',
      event: DUPLICATE_EVENT,
      timeoutMs: 5_000,
    },
  })
  assert.notEqual(debugWaitResult.isError, true)
  const debugWait = debugWaitResult.structuredContent
  assert.equal(debugWait?.outcome, 'found')
  assert.equal(debugWait?.observation?.type, 'dispatch-observed')
  assert.equal(debugWait?.observation?.event, DUPLICATE_EVENT)
  assert.equal(typeof debugWait?.observation?.sequence, 'number')
  assert.equal(typeof debugWait?.observation?.dispatchId, 'number')
  assert.equal(typeof debugWait?.observation?.registeredListeners, 'number')
  assert.equal(debugWait?.session?.debugSessionId, debugSession.debugSessionId)

  const detachedDebugSession = await mcpClient.callTool({
    name: 'cordis_detach_debug_session',
    arguments: { debugSessionId: debugSession.debugSessionId },
  })
  assert.notEqual(detachedDebugSession.isError, true)
  assert.equal(detachedDebugSession.structuredContent?.debugSessionId, debugSession.debugSessionId)
  assert.equal(detachedDebugSession.structuredContent?.status, 'detached')

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
  assert.ok(duplicateEvidence.dispatches.records.some(record => record.registeredListeners === 2))

  const mcpBaselineResult = await mcpClient.callTool({
    name: 'cordis_capture_checkpoint',
    arguments: {
      scope: {
        eventNames: [VERIFICATION_EVENT],
        fiberNames: [VERIFICATION_FIBER_NAME],
      },
    },
  })
  assert.notEqual(mcpBaselineResult.isError, true)
  const mcpBaseline = mcpBaselineResult.structuredContent
  assertVerificationBaseline(mcpBaseline)

  await writeFile(verificationTransitionFile, 'transition\n', 'utf8')
  await waitForOutput('[cordis-devtools-e2e] runtime verification transition complete:', server)
  await waitForOutput('[cordis-devtools-e2e] CordisRuntime verification compare OK', server)

  const mcpCompareResult = await mcpClient.callTool({
    name: 'cordis_compare_current',
    arguments: { baseline: mcpBaseline },
  })
  assert.notEqual(mcpCompareResult.isError, true)
  const mcpVerificationSummary = summarizeVerificationComparison(mcpCompareResult.structuredContent)
  const inspectVerificationSummary = JSON.parse(await readFile(verificationInspectResultFile, 'utf8'))
  assert.deepEqual(mcpVerificationSummary, inspectVerificationSummary)

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
  console.log(`DSH Web + Cordis Inspect + external MCP runtime verification smoke passed at ${baseUrl} / ${mcpUrl}`)
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

function assertVerificationBaseline(checkpoint) {
  assert.equal(checkpoint?.schemaVersion, 1)
  assert.ok(checkpoint.events?.some(event => (
    event.name === VERIFICATION_EVENT && event.listenerCount === 2
  )))
  assert.equal(checkpoint.listeners?.filter(listener => listener.event === VERIFICATION_EVENT).length, 2)
  assert.equal(checkpoint.fibers?.filter(fiber => fiber.name === VERIFICATION_FIBER_NAME).length, 2)
}

function summarizeVerificationComparison(comparison) {
  assert.equal(comparison?.changed, true)
  const event = comparison.events?.find(row => (
    row.name === VERIFICATION_EVENT
    && row.beforeListenerCount === 2
    && row.afterListenerCount === 1
    && row.delta === -1
  ))
  const listener = comparison.listenerGroups?.find(row => (
    row.descriptor?.event === VERIFICATION_EVENT
    && row.descriptor?.ownerName === VERIFICATION_FIBER_NAME
    && row.beforeCount === 2
    && row.afterCount === 1
    && row.delta === -1
  ))
  const fiber = comparison.fiberGroups?.find(row => (
    row.descriptor?.name === VERIFICATION_FIBER_NAME
    && row.beforeCount === 2
    && row.afterCount === 1
    && row.delta === -1
  ))
  assert.ok(event, 'missing semantic event 2 -> 1 evidence')
  assert.ok(listener, 'missing semantic listener 2 -> 1 evidence')
  assert.ok(fiber, 'missing semantic Fiber 2 -> 1 evidence')

  return {
    changed: true,
    event: {
      before: event.beforeListenerCount,
      after: event.afterListenerCount,
      delta: event.delta,
    },
    listener: {
      before: listener.beforeCount,
      after: listener.afterCount,
      delta: listener.delta,
    },
    fiber: {
      before: fiber.beforeCount,
      after: fiber.afterCount,
      delta: fiber.delta,
    },
  }
}

async function waitForDuplicateEvidence(client) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const eventResult = await client.callTool({
      name: 'cordis_inspect_event',
      arguments: { name: DUPLICATE_EVENT },
    })
    const event = eventResult.structuredContent
    const liveOwners = event?.listeners
      ?.filter(listener => listener.ownerLive === true && listener.owner?.uid != null) ?? []
    const uniqueOwnerUids = [...new Set(liveOwners.map(listener => listener.owner.uid))]
    const uniqueOwnerNames = [...new Set(liveOwners.map(listener => listener.owner.name))]

    if (
      event?.found === true
      && event.listenerCount === 2
      && uniqueOwnerUids.length === 2
      && uniqueOwnerNames.length === 1
      && uniqueOwnerNames[0]
    ) {
      const byNameResult = await client.callTool({
        name: 'cordis_inspect_fiber',
        arguments: { name: uniqueOwnerNames[0] },
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
          && dispatches.records?.some(record => record.registeredListeners === 2)
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

async function waitForOutput(marker, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (serverOutput.includes(marker)) return
    if (child.exitCode !== null) {
      throw new Error(`dsh web exited before emitting ${marker} (code ${child.exitCode})`)
    }
    await delay(100)
  }
  throw new Error(`timed out waiting for DSH output marker: ${marker}`)
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
