export const name = 'dsh-cordis-devtools-e2e-controlled-experiment-probe'
export const inject = ['tools', 'approval', 'cordisDevtools']

const START_TOOL = 'cordis_start_waterfall_experiment'
const STOP_TOOL = 'cordis_stop_waterfall_experiment'
export const CONTROLLED_EVENT = 'cordis-devtools-e2e/controlled-experiment'

export async function apply(ctx) {
  const service = ctx.get('cordisDevtools')
  if (!service) throw new Error('cordisDevtools service is unavailable')

  ctx.on(CONTROLLED_EVENT, (steps, next) => {
    steps.push('controlled-listener')
    return next()
  })

  let approvalMode = 'unavailable'
  ctx.on('approval/request', (request, next) => {
    if (request.toolName !== START_TOOL) return next()
    if (approvalMode === 'allow') return Promise.resolve('allowed-once')
    if (approvalMode === 'reject') return Promise.resolve('rejected')
    return Promise.resolve('unavailable')
  })

  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: {} },
  ]
  const agent = {
    id: 'cordis-devtools-e2e-controlled-experiment-agent',
    session: {
      events,
      append(type, data) {
        const event = { type, data }
        events.push(event)
        return event
      },
    },
  }

  const signal = new AbortController().signal
  let call = 0
  const execute = async (tool, args) => {
    const result = await ctx.tools.execute({
      signal,
      callId: `cordis-devtools-e2e-${++call}`,
      name: tool,
      arguments: args,
      agent,
    })
    if (result?.isError === true) {
      const text = result.content?.find(block => block.type === 'text')?.text ?? 'unknown tool error'
      throw new Error(text)
    }
    const text = result?.content?.find(block => block.type === 'text')?.text
    if (typeof text !== 'string') throw new Error(`${tool} did not return JSON text`)
    return JSON.parse(text)
  }

  // `cordisDevtools` is provided before its optional DSH tool injection finishes.
  // Retry only the initial no-mutation probe until the real ToolRuntime sees it.
  let unavailable
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      unavailable = await execute(START_TOOL, { ttlMs: 5_000 })
      break
    } catch (error) {
      if (!String(error).toLowerCase().includes('unknown')) throw error
      await delay(50)
    }
  }
  if (unavailable?.outcome !== 'approval-denied' || unavailable.approval !== 'unavailable') {
    throw new Error(`unexpected unavailable start result: ${JSON.stringify(unavailable)}`)
  }
  assertDisabled(service, 'unavailable approval')

  approvalMode = 'reject'
  const rejected = await execute(START_TOOL, { ttlMs: 5_000 })
  if (rejected?.outcome !== 'approval-denied' || rejected.approval !== 'rejected') {
    throw new Error(`unexpected rejected start result: ${JSON.stringify(rejected)}`)
  }
  assertDisabled(service, 'rejected approval')

  approvalMode = 'allow'
  const started = await execute(START_TOOL, { ttlMs: 5_000 })
  const leaseId = started?.lease?.leaseId
  if (started?.outcome !== 'started' || started.lease?.source !== 'dsh' || typeof leaseId !== 'string') {
    throw new Error(`unexpected approved start result: ${JSON.stringify(started)}`)
  }

  const steps = []
  const outcome = ctx.waterfall(CONTROLLED_EVENT, steps, () => 'done')
  if (outcome !== 'done' || steps.join(',') !== 'controlled-listener') {
    throw new Error(`controlled waterfall behavior changed: ${JSON.stringify({ outcome, steps })}`)
  }
  const tagged = service.profilerSnapshot().traces.filter(trace => (
    trace.event === CONTROLLED_EVENT && trace.experimentId === leaseId
  ))
  if (tagged.length === 0) throw new Error('DSH-approved experiment produced no lease-tagged trace')

  const stale = await execute(STOP_TOOL, { leaseId: `${leaseId}-stale` })
  if (stale?.outcome !== 'lease-mismatch' || stale.status?.owner?.leaseId !== leaseId) {
    throw new Error(`stale lease stop mutated ownership: ${JSON.stringify(stale)}`)
  }

  const stopped = await execute(STOP_TOOL, { leaseId })
  if (stopped?.outcome !== 'stopped' || stopped.status?.instrumentation !== 'disabled') {
    throw new Error(`exact DSH lease stop failed: ${JSON.stringify(stopped)}`)
  }

  console.log('[cordis-devtools-e2e] real DSH approved experiment OK')

  // Keep producing a metadata-only waterfall occurrence for the subsequent MCP
  // and Human segments in the same DSH process. Outside instrumentation this
  // changes no DevTools state beyond the normal observer dispatch record.
  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        ctx.waterfall(CONTROLLED_EVENT, [], () => 'done')
      } catch (error) {
        console.error('[cordis-devtools-e2e] controlled periodic probe failed', error)
      }
    }, 100)
    return () => clearInterval(timer)
  }, 'dsh-cordis-devtools e2e controlled experiment waterfall probe')
}

function assertDisabled(service, label) {
  const status = service.waterfallExperimentStatus()
  if (status.instrumentation !== 'disabled' || status.owner?.kind !== 'none') {
    throw new Error(`${label} unexpectedly mutated instrumentation: ${JSON.stringify(status)}`)
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
