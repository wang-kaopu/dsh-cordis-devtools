import { Context } from '@deepseek-ai/cordis'
import { isDeepStrictEqual } from 'node:util'
import { performance } from 'node:perf_hooks'

export type ScenarioOutcome = 'returned' | 'threw' | 'fulfilled' | 'rejected'

export interface ScenarioObservation<T> {
  outcome: ScenarioOutcome
  value?: T
  errorToken?: string
}

export interface ScenarioOptions {
  prepare?: (ctx: Context) => void | Promise<void>
  errorToken?: (reason: unknown) => string
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false
}

export async function runScenario<T>(
  scenario: (ctx: Context) => T | PromiseLike<T>,
  options: ScenarioOptions = {},
): Promise<ScenarioObservation<T>> {
  const ctx = new Context()
  await options.prepare?.(ctx)

  let result: T | PromiseLike<T>
  try {
    result = scenario(ctx)
  } catch (reason) {
    return { outcome: 'threw', errorToken: options.errorToken?.(reason) ?? classifyError(reason) }
  }

  if (!isThenable(result)) return { outcome: 'returned', value: result }

  try {
    return { outcome: 'fulfilled', value: await result }
  } catch (reason) {
    return { outcome: 'rejected', errorToken: options.errorToken?.(reason) ?? classifyError(reason) }
  }
}

export interface ParityComparison {
  equal: boolean
  differences: string[]
}

export function compareParity<T>(
  baseline: ScenarioObservation<T>,
  candidate: ScenarioObservation<T>,
): ParityComparison {
  const differences: string[] = []
  if (baseline.outcome !== candidate.outcome) differences.push('outcome')
  if (!isDeepStrictEqual(baseline.value, candidate.value)) differences.push('value')
  if (baseline.errorToken !== candidate.errorToken) differences.push('errorToken')
  return { equal: differences.length === 0, differences }
}

export interface BenchmarkResult {
  samples: number
  totalMs: number
  meanMs: number
  minMs: number
  maxMs: number
}

export function benchmark(samples: number, invoke: () => void): BenchmarkResult {
  if (!Number.isInteger(samples) || samples <= 0) throw new RangeError('samples must be a positive integer')
  const durations: number[] = []
  const started = performance.now()
  for (let index = 0; index < samples; index++) {
    const sampleStarted = performance.now()
    invoke()
    durations.push(performance.now() - sampleStarted)
  }
  const totalMs = performance.now() - started
  return {
    samples,
    totalMs,
    meanMs: durations.reduce((sum, value) => sum + value, 0) / samples,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  }
}

function classifyError(reason: unknown): string {
  if (reason instanceof Error) return reason.name
  return typeof reason
}
