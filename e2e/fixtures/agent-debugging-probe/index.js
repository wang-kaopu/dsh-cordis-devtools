export const name = 'dsh-cordis-devtools-e2e-agent-debugging-probe'

export const DUPLICATE_EVENT = 'cordis-devtools-e2e/duplicate-listener'
export const DUPLICATE_FIBER_NAME = 'cordis-devtools-e2e-duplicate-plugin'

function duplicatePlugin() {
  return {
    name: DUPLICATE_FIBER_NAME,
    apply(pluginCtx) {
      pluginCtx.on(DUPLICATE_EVENT, () => undefined)
      pluginCtx.effect(() => {
        const timer = setInterval(() => {
          pluginCtx.emit(DUPLICATE_EVENT)
        }, 250)
        return () => { clearInterval(timer) }
      }, 'dsh-cordis-devtools e2e duplicate dispatch probe')
    },
  }
}

export async function apply(ctx) {
  await ctx.effect(async () => {
    const first = await ctx.plugin(duplicatePlugin())
    const second = await ctx.plugin(duplicatePlugin())
    console.log(`[cordis-devtools-e2e] duplicate Fibers ready: ${first.uid},${second.uid}`)

    return async () => {
      await Promise.allSettled([second.dispose(), first.dispose()])
    }
  }, 'dsh-cordis-devtools e2e duplicate Fiber fixture')
}
