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
const CONTROLLED_EVENT = 'cordis-devtools-e2e/controlled-experiment'
const MCP_TOKEN = 'cordis-devtools-e2e-controlled-secret'
const repoRoot = process.cwd()
const fixtureRoot = join(repoRoot, 'e2e', 'fixtures', 'controlled-experiment-probe')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const dshHome = await mkdtemp(join(tmpdir(), 'dsh-cordis-devtools-controlled-e2e-'))
const port = await getFreePort()
const mcpPort = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`
const mcpPatch = join(dshHome, 'cordis-devtools-controlled-mcp.patch.yml')
const env = { ...process.env, CI: '1', DSH_HOME: dshHome }

let server
let browser
let mcpClient
let serverOutput = ''

try {
  await run(pnpm, ['dlx', DSH_PACKAGE, 'plugin', '--profile', 'web', 'add', repoRoot], { env })
  await run(pnpm, ['dlx', DSH_PACKAGE, 'plugin', '--profile', 'web', 'add', fixtureRoot], { env })
  await writeFile(mcpPatch, [
    '- id: dsh-cordis-devtools',
    '  config:',
    '    mcp:',
    '      enabled: true',
    `      port: ${mcpPort}`,
    `      token: ${MCP_TOKEN}`,
    '      experiments:',
    '        enabled: true',
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
  await waitForOutput('[cordis-devtools-e2e] real DSH approved experiment OK', server)
  await waitForPort(mcpPort, server)

  // Auth is enforced before MCP request parsing or coordinator dispatch.
  const missingAuth = await fetch(mcpUrl, { method: 'POST', body: '{}' })
  assert.equal(missingAuth.status, 401)
  const badAuth = await fetch(mcpUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-token' },
    body: '{}',
  })
  assert.equal(badAuth.status, 401)

  mcpClient = new Client({ name: 'dsh-cordis-devtools-controlled-e2e', version: '1.0.0' })
  await mcpClient.connect(new StreamableHTTPClientTransport(
    new URL(mcpUrl),
    { requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } } },
  ))
  const tools = await mcpClient.listTools()
  assert.deepEqual(tools.tools.map(tool => tool.name), [
    'cordis_runtime_summary',
    'cordis_inspect_event',
    'cordis_inspect_fiber',
    'cordis_search_dispatches',
    'cordis_profiler_traces',
    'cordis_capture_checkpoint',
    'cordis_compare_current',
    'cordis_waterfall_experiment_status',
    'cordis_start_waterfall_experiment',
    'cordis_stop_waterfall_experiment',
  ])
  assertDisabled(await mcpCall('cordis_waterfall_experiment_status'))

  const started = await mcpCall('cordis_start_waterfall_experiment', { ttlMs: 5_000 })
  assert.equal(started.outcome, 'started')
  assert.equal(started.lease?.source, 'mcp')
  const leaseId = started.lease?.leaseId
  assert.equal(typeof leaseId, 'string')

  const traces = await waitForExperimentTrace(leaseId)
  assert.ok(traces.traces.length > 0)
  assert.ok(traces.traces.every(trace => trace.experimentId === leaseId))
  assert.ok(traces.traces.every(trace => trace.event === CONTROLLED_EVENT))

  const stale = await mcpCall('cordis_stop_waterfall_experiment', { leaseId: `${leaseId}-stale` })
  assert.equal(stale.outcome, 'lease-mismatch')
  assert.equal(stale.status?.owner?.leaseId, leaseId)

  // While MCP owns instrumentation, Human DevTools must show ownership and the
  // only local action must be the authoritative emergency stop.
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await completeBlockingOnboarding(page)
  await page.locator('[data-testid="cordis-devtools-trigger"]').click()
  const panel = page.locator('[data-testid="cordis-devtools-panel"]')
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'Profiler', exact: true }).click()
  const profiler = page.getByRole('region', { name: 'Waterfall Profiler' })
  await profiler.waitFor({ state: 'visible', timeout: 10_000 })
  const toggle = page.locator('[data-testid="cordis-devtools-profiler-toggle"]')
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Stop Agent experiment'
  ), undefined, { timeout: 10_000 })
  assert.match(await profiler.textContent() ?? '', /Agent · mcp/)

  await toggle.click()
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Enable profiling'
  ), undefined, { timeout: 10_000 })
  assertDisabled(await mcpCall('cordis_waterfall_experiment_status'))

  // A later lease proves finite TTL cleanup independently of the Human stop.
  const expiring = await mcpCall('cordis_start_waterfall_experiment', { ttlMs: 400 })
  assert.equal(expiring.outcome, 'started')
  assert.equal(expiring.lease?.source, 'mcp')
  await waitFor(async () => {
    const status = await mcpCall('cordis_waterfall_experiment_status')
    return status.instrumentation === 'disabled' && status.owner?.kind === 'none'
  }, 5_000, 'MCP experiment TTL expiry')

  // Existing Human profiling remains usable after Agent leases have ended.
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Enable profiling'
  ), undefined, { timeout: 10_000 })
  await toggle.click()
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Disable profiling'
  ), undefined, { timeout: 10_000 })
  const humanStatus = await mcpCall('cordis_waterfall_experiment_status')
  assert.equal(humanStatus.instrumentation, 'enabled')
  assert.equal(humanStatus.owner?.kind, 'human')
  await delay(250)
  const humanTraces = await mcpCall('cordis_profiler_traces', { event: CONTROLLED_EVENT, limit: 20 })
  assert.ok(humanTraces.traces.some(trace => trace.event === CONTROLLED_EVENT && trace.experimentId === undefined))
  await toggle.click()
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="cordis-devtools-profiler-toggle"]')?.textContent === 'Enable profiling'
  ), undefined, { timeout: 10_000 })
  assertDisabled(await mcpCall('cordis_waterfall_experiment_status'))

  assert.deepEqual(pageErrors, [], `browser page errors:\n${pageErrors.map(String).join('\n')}`)
  console.log(`DSH approved tools + authenticated MCP + Human controlled experiment smoke passed at ${baseUrl} / ${mcpUrl}`)
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

async function mcpCall(name, args = {}) {
  const result = await mcpClient.callTool({ name, arguments: args })
  assert.notEqual(result.isError, true, `${name} returned an MCP error`)
  return result.structuredContent
}

async function waitForExperimentTrace(experimentId) {
  let found
  await waitFor(async () => {
    found = await mcpCall('cordis_profiler_traces', {
      event: CONTROLLED_EVENT,
      experimentId,
      limit: 20,
    })
    return found?.traces?.length > 0
  }, 5_000, `trace for experiment ${experimentId}`)
  return found
}

function assertDisabled(status) {
  assert.equal(status?.instrumentation, 'disabled')
  assert.equal(status?.owner?.kind, 'none')
}

async function completeBlockingOnboarding(page) {
  const welcome = page.getByRole('dialog', { name: /Internal Testing Notice|内测声明/ }).first()
  const welcomeAppeared = await welcome.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
  if (welcomeAppeared) {
    await welcome.getByRole('button', { name: /^(Continue|继续)$/ }).click()
    await welcome.waitFor({ state: 'hidden', timeout: 15_000 })
  }
  const credential = page.getByRole('dialog', {
    name: /Add an API key to get started|添加一个 API Key 开始使用/,
  }).first()
  const credentialAppeared = await credential.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
  if (credentialAppeared) {
    await credential.getByRole('button', { name: /^(Configure later|稍后配置)$/ }).click()
    await credential.waitFor({ state: 'hidden', timeout: 15_000 })
  }
}

async function getFreePort() {
  const socket = net.createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const address = socket.address()
  assert(address && typeof address === 'object')
  const selected = address.port
  await new Promise(resolve => socket.close(resolve))
  return selected
}

async function waitForServer(url, child) {
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`dsh web exited early with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      return response.ok
    } catch {
      return false
    }
  }, 60_000, `DSH Web ${url}`)
}

async function waitForOutput(marker, child) {
  await waitFor(() => {
    if (child.exitCode !== null) throw new Error(`dsh web exited before emitting ${marker}`)
    return serverOutput.includes(marker)
  }, 30_000, `DSH output marker ${marker}`)
}

async function waitForPort(targetPort, child) {
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`dsh web exited before MCP port ${targetPort} opened`)
    return await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port: targetPort })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
  }, 30_000, `MCP port ${targetPort}`)
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error(`timed out waiting for ${label}`)
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
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error([`${command} ${args.join(' ')} failed with code ${code}`, stdout, stderr].filter(Boolean).join('\n')))
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
