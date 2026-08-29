import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/**
 * 验证 loopback HTTP/WebSocket 请求中的 Bearer Authorization。
 *
 * 未配置 token 时保持现有本地服务的免认证行为；配置空 token 或收到
 * 不匹配的 token 时拒绝请求，并在调用 timingSafeEqual 前检查字节长度。
 */
export function isAuthorized(req: Pick<IncomingMessage, 'headers'>, token: string | undefined): boolean {
  if (token === undefined) return true
  if (token.length === 0) return false

  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false

  const expectedBytes = Buffer.from(token)
  const presentedBytes = Buffer.from(header.slice('Bearer '.length))
  if (expectedBytes.byteLength !== presentedBytes.byteLength) return false
  return timingSafeEqual(expectedBytes, presentedBytes)
}
