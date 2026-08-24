export const name = 'dsh-cordis-devtools-e2e-inspect-probe'
export const inject = ['cordisInspect']

const DUPLICATE_EVENT = 'cordis-devtools-e2e/duplicate-listener'

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
}
