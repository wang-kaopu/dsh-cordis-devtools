import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'dsh-cordis-devtools-e2e-inspect-probe'
export const inject = ['cordisInspect']

const DUPLICATE_EVENT = 'cordis-devtools-e2e/duplicate-listener'
const VERIFICATION_EVENT = 'cordis-devtools-e2e/runtime-verification-duplicate'
const VERIFICATION_FIBER_NAME = 'cordis-devtools-e2e-runtime-verification-plugin'
const VERIFICATION_RESULT_FILENAME = 'cordis-devtools-e2e-runtime-verification-inspect-result.json'

export function apply(ctx) {
  console.log('[cordis-devtools-e2e] CordisRuntime inspect probe started')

  ctx.effect(() => {
    let done = false
    let running = false
    const timer = setInterval(async () => {
      if (done || running) return
      running = true
      try {
        const runtime = ctx.cordisInspect.list().find(provider => (
          provider.platform === 'host' && provider.id === 'CordisRuntime'
        ))
        if (runtime === undefined) return

        const signal = new AbortController().signal
        const agent = { id: 'cordis-devtools-e2e-agent' }
        const event = await ctx.cordisInspect.query(
          'host',
          'CordisRuntime',
          'inspectEvent',
          { name: DUPLICATE_EVENT },
          agent,
          signal,
        )
        const liveOwners = event?.listeners
          ?.filter(listener => listener.ownerLive === true && listener.owner?.uid != null) ?? []
        const uniqueOwnerUids = [...new Set(liveOwners.map(listener => listener.owner.uid))]
        const uniqueOwnerNames = [...new Set(liveOwners.map(listener => listener.owner.name))]
        if (
          event?.found !== true
          || event.listenerCount !== 2
          || uniqueOwnerUids.length !== 2
          || uniqueOwnerNames.length !== 1
          || !uniqueOwnerNames[0]
        ) return

        const byName = await ctx.cordisInspect.query(
          'host',
          'CordisRuntime',
          'inspectFiber',
          { name: uniqueOwnerNames[0] },
          agent,
          signal,
        )
        if (
          byName?.matches?.length !== 2
          || !uniqueOwnerUids.every(uid => byName.matches.some(fiber => fiber.uid === uid))
        ) return

        for (const uid of uniqueOwnerUids) {
          const byUid = await ctx.cordisInspect.query(
            'host',
            'CordisRuntime',
            'inspectFiber',
            { uid },
            agent,
            signal,
          )
          if (
            byUid?.matches?.length !== 1
            || byUid.matches[0].uid !== uid
            || !byUid.matches[0].ownedEvents?.includes(DUPLICATE_EVENT)
          ) return
        }

        const dispatches = await ctx.cordisInspect.query(
          'host',
          'CordisRuntime',
          'searchDispatches',
          { event: DUPLICATE_EVENT, limit: 20 },
          agent,
          signal,
        )
        if (
          dispatches?.window?.bounded !== true
          || !dispatches.records?.some(record => record.registeredListeners === 2)
        ) return

        done = true
        clearInterval(timer)
        console.log('[cordis-devtools-e2e] CordisRuntime duplicate-fiber inspect OK')
      } catch (error) {
        console.error('[cordis-devtools-e2e] CordisRuntime inspect retry', error)
      } finally {
        running = false
      }
    }, 100)

    return () => { clearInterval(timer) }
  }, 'dsh-cordis-devtools e2e CordisRuntime inspect probe')

  ctx.effect(() => {
    let baseline
    let done = false
    let running = false
    const timer = setInterval(async () => {
      if (done || running) return
      running = true
      try {
        const runtime = ctx.cordisInspect.list().find(provider => (
          provider.platform === 'host' && provider.id === 'CordisRuntime'
        ))
        if (runtime === undefined) return

        const signal = new AbortController().signal
        const agent = { id: 'cordis-devtools-e2e-verification-agent' }
        if (baseline === undefined) {
          const captured = await ctx.cordisInspect.query(
            'host',
            'CordisRuntime',
            'captureCheckpoint',
            {
              scope: {
                eventNames: [VERIFICATION_EVENT],
                fiberNames: [VERIFICATION_FIBER_NAME],
              },
            },
            agent,
            signal,
          )
          if (!isVerificationBaseline(captured)) return
          baseline = captured
          console.log('[cordis-devtools-e2e] CordisRuntime verification baseline captured')
          return
        }

        const comparison = await ctx.cordisInspect.query(
          'host',
          'CordisRuntime',
          'compareCurrent',
          { baseline },
          agent,
          signal,
        )
        const summary = summarizeVerificationComparison(comparison)
        if (summary === null) return

        const resultFile = process.env.DSH_HOME
          ? join(process.env.DSH_HOME, VERIFICATION_RESULT_FILENAME)
          : null
        if (resultFile === null) throw new Error('DSH_HOME is required for runtime verification E2E')
        await writeFile(resultFile, JSON.stringify(summary), 'utf8')

        done = true
        clearInterval(timer)
        console.log('[cordis-devtools-e2e] CordisRuntime verification compare OK')
      } catch (error) {
        console.error('[cordis-devtools-e2e] CordisRuntime verification retry', error)
      } finally {
        running = false
      }
    }, 100)

    return () => { clearInterval(timer) }
  }, 'dsh-cordis-devtools e2e CordisRuntime verification probe')
}

function isVerificationBaseline(checkpoint) {
  return checkpoint?.schemaVersion === 1
    && checkpoint.events?.some(event => (
      event.name === VERIFICATION_EVENT && event.listenerCount === 2
    ))
    && checkpoint.listeners?.filter(listener => listener.event === VERIFICATION_EVENT).length === 2
    && checkpoint.fibers?.filter(fiber => fiber.name === VERIFICATION_FIBER_NAME).length === 2
}

function summarizeVerificationComparison(comparison) {
  if (comparison?.changed !== true) return null
  const event = comparison.events?.find(row => (
    row.name === VERIFICATION_EVENT
    && row.beforeListenerCount === 2
    && row.afterListenerCount === 1
    && row.delta === -1
  ))
  const listener = comparison.listenerGroups?.find(row => (
    row.descriptor?.event === VERIFICATION_EVENT
    && row.descriptor?.ownerName === VERIFICATION_FIBER_NAME
    && row.beforeCount === 2
    && row.afterCount === 1
    && row.delta === -1
  ))
  const fiber = comparison.fiberGroups?.find(row => (
    row.descriptor?.name === VERIFICATION_FIBER_NAME
    && row.beforeCount === 2
    && row.afterCount === 1
    && row.delta === -1
  ))
  if (!event || !listener || !fiber) return null

  return {
    changed: true,
    event: {
      before: event.beforeListenerCount,
      after: event.afterListenerCount,
      delta: event.delta,
    },
    listener: {
      before: listener.beforeCount,
      after: listener.afterCount,
      delta: listener.delta,
    },
    fiber: {
      before: fiber.beforeCount,
      after: fiber.afterCount,
      delta: fiber.delta,
    },
  }
}
