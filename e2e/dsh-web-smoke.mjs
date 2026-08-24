import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const DSH_PACKAGE = '@deepseek-ai/dsh@0.1.1-rc.2'
const repoRoot = process.cwd()
const probeRoot = join(repoRoot, 'e2e', 'fixtures', 'waterfall-probe')
const inspectProbeRoot = join(repoRoot, 'e2e', 'fixtures', 'cordis-inspect-probe')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const dshHome = await mkdtemp(join(tmpdir(), 'dsh-cordis-devtools-e2e-'))
const port = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  CI: '1',
  DSH_HOME: dshHome,
}

let server
let browser
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
    'plugin', '--profile', 'web', 'add', inspectProbeRoot,
  ], { env })

  server = spawn(pnpm, [
    'dlx', DSH_PACKAGE,
    'web', '--no-open', '--host', '127.0.0.1', '--port', String(port),
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
  await waitForOutput('[cordis-devtools-e2e] CordisRuntime inspect OK', server)

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
  console.log(`DSH Web smoke passed at ${baseUrl}`)
} catch (error) {
  if (serverOutput.length > 0) {
    console.error('\n--- dsh web output ---\n' + serverOutput + '\n--- end dsh web output ---')
  }
  throw error
} finally {
  await browser?.close().catch(() => {})
  await stop(server)
  await rm(dshHome, { recursive: true, force: true })
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
