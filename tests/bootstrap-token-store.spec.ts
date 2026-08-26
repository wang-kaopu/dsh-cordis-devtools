import { describe, expect, it } from 'vitest'
import { McpTokenFileError, readMcpTokenFile, type TokenFileStats, type TokenFileSystem } from '../src/bootstrap/token-store.js'

function stats(mode = 0o600, file = true, symbolicLink = false): TokenFileStats {
  return { mode, isFile: () => file, isSymbolicLink: () => symbolicLink }
}

function fileSystem(options: {
  stats?: TokenFileStats
  content?: string
  lstatError?: unknown
  readError?: unknown
} = {}): TokenFileSystem {
  return {
    async lstat() {
      if (options.lstatError !== undefined) throw options.lstatError
      return options.stats ?? stats()
    },
    async readFile() {
      if (options.readError !== undefined) throw options.readError
      return options.content ?? '  test-token  \n'
    },
  }
}

describe('MCP token file loader', () => {
  it('returns trimmed non-empty token content', async () => {
    await expect(readMcpTokenFile('/tmp/dsh-token', fileSystem({ content: '  secret  \n' }), 'darwin')).resolves.toBe('secret')
  })

  it('requires an absolute normalized path', async () => {
    for (const path of ['relative/token', '/tmp/../token', '/tmp//token']) {
      await expect(readMcpTokenFile(path, fileSystem(), 'darwin')).rejects.toThrow(McpTokenFileError)
    }
  })

  it('rejects symlinks and non-regular files', async () => {
    await expect(readMcpTokenFile('/tmp/token', fileSystem({ stats: stats(0o600, true, true) }), 'linux')).rejects.toThrow('must not be a symlink')
    await expect(readMcpTokenFile('/tmp/token', fileSystem({ stats: stats(0o600, false) }), 'linux')).rejects.toThrow('regular file')
  })

  it('rejects group or other permissions and missing owner read permission', async () => {
    await expect(readMcpTokenFile('/tmp/token', fileSystem({ stats: stats(0o640) }), 'linux')).rejects.toThrow('owner only')
    await expect(readMcpTokenFile('/tmp/token', fileSystem({ stats: stats(0o200) }), 'linux')).rejects.toThrow('owner only')
  })

  it('rejects unsupported platforms closed', async () => {
    await expect(readMcpTokenFile('/tmp/token', fileSystem(), 'win32')).rejects.toThrow('unsupported')
  })

  it('rejects empty content without exposing path or content', async () => {
    const path = '/tmp/private-token-file'
    const error = await readMcpTokenFile(path, fileSystem({ content: '  \n\t' }), 'darwin').catch(value => value)
    expect(error).toBeInstanceOf(McpTokenFileError)
    expect(String(error)).not.toContain(path)
  })

  it('redacts filesystem failures', async () => {
    const secret = 'secret-from-fs-error'
    const error = await readMcpTokenFile('/tmp/token', fileSystem({ readError: new Error(secret) }), 'linux').catch(value => value)
    expect(error).toBeInstanceOf(McpTokenFileError)
    expect(String(error)).not.toContain(secret)
  })
})
