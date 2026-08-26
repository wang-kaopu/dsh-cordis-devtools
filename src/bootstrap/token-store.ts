import { lstat as nodeLstat, readFile as nodeReadFile } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'

/** Minimal file metadata needed to validate a local MCP token file. */
export interface TokenFileStats {
  mode: number
  isFile(): boolean
  isSymbolicLink(): boolean
}

/** Filesystem operations used by the token loader, injectable for deterministic tests. */
export interface TokenFileSystem {
  lstat(path: string): Promise<TokenFileStats>
  readFile(path: string): Promise<string>
}

/** Stable error raised when a token file cannot be accepted without exposing secret material. */
export class McpTokenFileError extends Error {
  readonly code = 'invalid-mcp-token-file'

  constructor(message: string) {
    super(message)
    this.name = 'McpTokenFileError'
  }
}

const nodeFileSystem: TokenFileSystem = {
  lstat: path => nodeLstat(path),
  readFile: path => nodeReadFile(path, 'utf8'),
}

/**
 * Reads and validates the bearer token from an owner-only local file.
 *
 * The path must already be an absolute, normalized path. The file is checked
 * with lstat so symlinks are rejected, and all filesystem failures are
 * replaced with a redacted error that cannot contain file contents.
 *
 * @param filePath - Absolute, normalized path to the token file.
 * @param fileSystem - Filesystem seam used for production I/O or tests.
 * @param platform - Operating-system identifier used for fail-closed checks.
 * @returns The trimmed, non-empty bearer token.
 */
export async function readMcpTokenFile(
  filePath: string,
  fileSystem: TokenFileSystem = nodeFileSystem,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new McpTokenFileError('MCP token file permissions are unsupported on this platform')
  }

  if (!isAbsolute(filePath) || normalize(filePath) !== filePath) {
    throw new McpTokenFileError('MCP token file path must be an absolute normalized path')
  }

  let stats: TokenFileStats
  try {
    stats = await fileSystem.lstat(filePath)
  } catch {
    throw new McpTokenFileError('MCP token file cannot be accessed')
  }

  if (stats.isSymbolicLink()) {
    throw new McpTokenFileError('MCP token file must not be a symlink')
  }
  if (!stats.isFile()) {
    throw new McpTokenFileError('MCP token file must be a regular file')
  }
  if ((stats.mode & 0o077) !== 0 || (stats.mode & 0o400) === 0) {
    throw new McpTokenFileError('MCP token file must be readable by its owner only')
  }

  let content: string
  try {
    content = await fileSystem.readFile(filePath)
  } catch {
    throw new McpTokenFileError('MCP token file cannot be read')
  }

  const token = content.trim()
  if (token.length === 0) {
    throw new McpTokenFileError('MCP token file must contain a non-empty token')
  }
  return token
}
