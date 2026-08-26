import { describe, expect, it } from 'vitest'
import { main } from '../src/cli.js'
import {
  runBootstrapCli,
  type BootstrapFileStats,
  type BootstrapFileSystem,
} from '../src/bootstrap/profile-bootstrap.js'

const HOME = '/tmp/dsh-bootstrap-test'
const PROFILE = `${HOME}/profiles/web`
const PATCH = `${PROFILE}/cordis.patch.yml`
const TOKEN = `${PROFILE}/.dsh-cordis-devtools-token`
const LOCK = `${PROFILE}/.dsh-cordis-devtools-bootstrap.lock`

function stats(kind: 'file' | 'directory' | 'symlink', mode = 0o600): BootstrapFileStats {
  return {
    mode,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink',
  }
}

class MemoryFiles implements BootstrapFileSystem {
  readonly entries = new Map<string, { contents: string; stats: BootstrapFileStats }>()

  constructor(patch = '- id: other\n  config: { enabled: true }\n- id: dsh-cordis-devtools\n  config:\n    keep: true\n    mcp:\n      token: old-inline-secret\n      custom: retained\n- !!js/function retained\n') {
    this.entries.set(PROFILE, { contents: '', stats: stats('directory') })
    this.entries.set(PATCH, { contents: patch, stats: stats('file', 0o644) })
  }

  async lstat(path: string): Promise<BootstrapFileStats> {
    const entry = this.entries.get(path)
    if (entry === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return entry.stats
  }

  async readFile(path: string): Promise<string> {
    const entry = this.entries.get(path)
    if (entry === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return entry.contents
  }

  async writeFile(path: string, contents: string, options?: { flag?: string; mode?: number }): Promise<void> {
    if (options?.flag === 'wx' && this.entries.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    this.entries.set(path, { contents, stats: stats('file', options?.mode ?? 0o644) })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const entry = this.entries.get(oldPath)
    if (entry === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    this.entries.set(newPath, entry)
    this.entries.delete(oldPath)
  }

  async unlink(path: string): Promise<void> {
    if (!this.entries.delete(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  }
}

describe('profile bootstrap CLI', () => {
  it('preserves unrelated YAML entries/config and registers Codex without token argv material', async () => {
    const files = new MemoryFiles()
    const spawned: { command: string; args: readonly string[] }[] = []
    const result = await runBootstrapCli(['setup', '--profile', 'web', '--agent', 'codex'], {
      env: { DSH_HOME: HOME }, files, randomToken: () => 'generated-secret',
      spawnCodex: async (command, args) => { spawned.push({ command, args }) },
    })
    expect(result.value).toMatchObject({ command: 'setup', profile: 'web', tokenFile: TOKEN, reloadRequired: true })
    expect(files.entries.get(TOKEN)?.contents).toBe('generated-secret\n')
    const patch = files.entries.get(PATCH)?.contents ?? ''
    expect(patch).toContain('id: other')
    expect(patch).toContain('!!js/function retained')
    expect(patch).toContain('keep: true')
    expect(patch).toContain('custom: retained')
    expect(patch).toContain(`tokenFile: ${TOKEN}`)
    expect(patch).not.toContain('old-inline-secret')
    expect(spawned).toEqual([{
      command: 'codex',
      args: ['mcp', 'add', 'dsh-cordis-devtools', '--', 'dsh-cordis-devtools-mcp', '--endpoint', 'http://127.0.0.1:43127/mcp', '--token-file', TOKEN],
    }])
    expect(JSON.stringify(spawned)).not.toContain('generated-secret')
  })

  it('doctor reads the owner-only token and proves authenticated tool discovery without returning it', async () => {
    const files = new MemoryFiles()
    files.entries.set(TOKEN, { contents: 'doctor-secret\n', stats: stats('file', 0o600) })
    await runBootstrapCli(['setup', '--profile', 'web', '--agent', 'codex'], { env: { DSH_HOME: HOME }, files, randomToken: () => 'generated-secret', spawnCodex: async () => {} })
    const seen: string[] = []
    const result = await runBootstrapCli(['doctor', '--profile', 'web'], {
      env: { DSH_HOME: HOME }, files,
      discoverTools: async (_endpoint, token) => { seen.push(token); return ['cordis_list_debug_targets'] },
    })
    expect(result.value).toMatchObject({ command: 'doctor', authenticated: true, tools: ['cordis_list_debug_targets'] })
    expect(seen).toEqual(['generated-secret'])
    expect(JSON.stringify(result.value)).not.toContain('generated-secret')
  })

  it('rotates atomically under the profile lock and requires reload', async () => {
    const files = new MemoryFiles()
    files.entries.set(TOKEN, { contents: 'old-secret\n', stats: stats('file', 0o600) })
    const result = await runBootstrapCli(['rotate-token', '--profile', 'web'], { env: { DSH_HOME: HOME }, files, randomToken: () => 'new-secret' })
    expect(result.value).toMatchObject({ command: 'rotate-token', reloadRequired: true })
    expect(files.entries.get(TOKEN)?.contents).toBe('new-secret\n')
    expect(files.entries.has(LOCK)).toBe(false)
    expect(JSON.stringify(result.value)).not.toContain('new-secret')
  })

  it('rejects unsafe profile names, token symlinks, and an existing advisory lock', async () => {
    await expect(runBootstrapCli(['doctor', '--profile', '../web'], { env: { DSH_HOME: HOME }, files: new MemoryFiles() })).rejects.toThrow('safe path segment')
    const symlinkFiles = new MemoryFiles()
    symlinkFiles.entries.set(TOKEN, { contents: 'secret', stats: stats('symlink') })
    await expect(runBootstrapCli(['rotate-token', '--profile', 'web'], { env: { DSH_HOME: HOME }, files: symlinkFiles, randomToken: () => 'new-secret' })).rejects.toThrow('regular non-symlink')
    const lockedFiles = new MemoryFiles()
    lockedFiles.entries.set(LOCK, { contents: '', stats: stats('file', 0o600) })
    await expect(runBootstrapCli(['setup', '--profile', 'web', '--agent', 'codex'], { env: { DSH_HOME: HOME }, files: lockedFiles })).rejects.toThrow('locked')
    const doctorLockedFiles = new MemoryFiles()
    doctorLockedFiles.entries.set(TOKEN, { contents: 'doctor-secret\n', stats: stats('file', 0o600) })
    await runBootstrapCli(['setup', '--profile', 'web', '--agent', 'codex'], { env: { DSH_HOME: HOME }, files: doctorLockedFiles, randomToken: () => 'configured-secret', spawnCodex: async () => {} })
    doctorLockedFiles.entries.set(LOCK, { contents: '', stats: stats('file', 0o600) })
    await expect(runBootstrapCli(['doctor', '--profile', 'web'], { env: { DSH_HOME: HOME }, files: doctorLockedFiles, discoverTools: async () => [] })).resolves.toBeDefined()
    expect(doctorLockedFiles.entries.has(LOCK)).toBe(true)
  })

  it('fails closed for setup on platforms without owner-only permission semantics', async () => {
    await expect(runBootstrapCli(['setup', '--profile', 'web', '--agent', 'codex'], {
      env: { DSH_HOME: HOME }, files: new MemoryFiles(), platform: 'win32', randomToken: () => 'secret', spawnCodex: async () => {},
    })).rejects.toThrow('unsupported')
  })

  it('short-circuits global endpoint/token parsing for bootstrap commands', async () => {
    const files = new MemoryFiles()
    const stdout: string[] = []
    let created = false
    const result = await main(['setup', '--profile', 'web', '--agent', 'codex'], {
      env: { DSH_HOME: HOME },
      io: { writeStdout: text => { stdout.push(text) }, writeStderr: () => {} },
      bootstrap: { files, randomToken: () => 'main-secret', spawnCodex: async () => {} },
      createClient: async () => { created = true; throw new Error('must not connect') },
      setExitCode: () => {},
    })
    expect(result.exitCode).toBe(0)
    expect(created).toBe(false)
    expect(stdout.join('')).not.toContain('main-secret')
  })
})
