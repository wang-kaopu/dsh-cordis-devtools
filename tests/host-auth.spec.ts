import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { isAuthorized } from '../src/host/auth.js'

function request(authorization?: string): Pick<IncomingMessage, 'headers'> {
  return { headers: authorization === undefined ? {} : { authorization } }
}

describe('loopback bearer authorization', () => {
  it('allows requests when authentication is not configured', () => {
    expect(isAuthorized(request(), undefined)).toBe(true)
    expect(isAuthorized(request('Bearer anything'), undefined)).toBe(true)
  })

  it('requires a correctly formed bearer header for a configured token', () => {
    expect(isAuthorized(request(), 'secret')).toBe(false)
    expect(isAuthorized(request('Basic secret'), 'secret')).toBe(false)
    expect(isAuthorized(request('Bearer secret'), 'secret')).toBe(true)
    expect(isAuthorized(request('Bearer wrong'), 'secret')).toBe(false)
  })

  it('rejects empty and different-length tokens without throwing', () => {
    expect(isAuthorized(request('Bearer '), '')).toBe(false)
    expect(isAuthorized(request('Bearer '), 'secret')).toBe(false)
    expect(isAuthorized(request('Bearer short'), 'secret')).toBe(false)
    expect(() => isAuthorized(request('Bearer short'), 'secret-token')).not.toThrow()
  })
})
