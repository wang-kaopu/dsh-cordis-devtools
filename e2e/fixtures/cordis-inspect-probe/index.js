export const name = 'dsh-cordis-devtools-e2e-inspect-probe'
export const inject = ['cordisInspect']

export function apply(ctx) {
  ctx.on('cordis-devtools-e2e/inspect-probe', () => undefined)

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

        const result = await ctx.cordisInspect.query(
          'host',
          'CordisRuntime',
          'inspectEvent',
          { name: 'cordis-devtools-e2e/inspect-probe' },
          { id: 'cordis-devtools-e2e-agent' },
          new AbortController().signal,
        )
        if (
          result?.found === true
          && result.listenerCount >= 1
          && result.listeners?.some(listener => listener.ownerLive === true)
        ) {
          done = true
          clearInterval(timer)
          console.log('[cordis-devtools-e2e] CordisRuntime inspect OK')
        }
      } catch (error) {
        console.error('[cordis-devtools-e2e] CordisRuntime inspect retry', error)
      } finally {
        running = false
      }
    }, 100)

    return () => { clearInterval(timer) }
  }, 'dsh-cordis-devtools e2e CordisRuntime inspect probe')
}
