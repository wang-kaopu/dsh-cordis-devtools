import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_DEBUG_CAPABILITIES,
  AGENT_DEBUG_PROTOCOL_NAME,
  AGENT_DEBUG_PROTOCOL_VERSION,
  DEFAULT_AGENT_DEBUG_CATALOG_LIMIT,
} from '../src/index.js'

describe('published package entries', () => {
  it('exports the Agent Debug v1 identity and keeps the CLI and skill files publishable', async () => {
    expect(AGENT_DEBUG_PROTOCOL_NAME).toBe('dsh-devtools-for-agents')
    expect(AGENT_DEBUG_PROTOCOL_VERSION).toBe(1)
    expect(DEFAULT_AGENT_DEBUG_CATALOG_LIMIT).toBe(100)
    expect(AGENT_DEBUG_CAPABILITIES).toContain('debug-session')

    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      bin?: Record<string, string>
      files?: string[]
    }
    expect(packageJson.bin).toMatchObject({ 'dsh-cordis-debug': 'lib/cli.js' })
    const bridgeEntry = packageJson.bin?.['dsh-cordis-devtools-mcp']
    expect(bridgeEntry).toMatch(/^lib\/.+\.js$/)
    expect(packageJson.files).toContain('skills')

    const cliEntry = await readFile(resolve(process.cwd(), 'lib/cli.js'), 'utf8')
    expect(cliEntry.length).toBeGreaterThan(0)
    const bridge = await readFile(resolve(process.cwd(), bridgeEntry as string), 'utf8')
    expect(bridge.length).toBeGreaterThan(0)
    const skill = await readFile(resolve(process.cwd(), 'skills/dsh-runtime-debugging/SKILL.md'), 'utf8')
    expect(skill.length).toBeGreaterThan(0)
  })
})
