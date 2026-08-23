import { describe, expect, it } from 'vitest'
import { RingBuffer } from '../src/host/ring-buffer.js'

describe('RingBuffer', () => {
  it('keeps only the newest values', () => {
    const buffer = new RingBuffer<number>(3)
    buffer.push(1)
    buffer.push(2)
    buffer.push(3)
    buffer.push(4)
    expect(buffer.toArray()).toEqual([2, 3, 4])
  })

  it('returns a defensive copy', () => {
    const buffer = new RingBuffer<number>(2)
    buffer.push(1)
    const snapshot = buffer.toArray()
    snapshot.push(2)
    expect(buffer.toArray()).toEqual([1])
  })

  it('clears all values', () => {
    const buffer = new RingBuffer<number>(2)
    buffer.push(1)
    buffer.clear()
    expect(buffer.size).toBe(0)
  })

  it('rejects invalid capacities', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError)
    expect(() => new RingBuffer(1.5)).toThrow(RangeError)
  })
})
