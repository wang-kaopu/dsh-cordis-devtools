export class RingBuffer<T> {
  private readonly items: T[] = []

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('capacity must be a positive integer')
    }
  }

  push(value: T): void {
    if (this.items.length === this.capacity) this.items.shift()
    this.items.push(value)
  }

  clear(): void {
    this.items.length = 0
  }

  toArray(): T[] {
    return [...this.items]
  }

  get size(): number {
    return this.items.length
  }
}
