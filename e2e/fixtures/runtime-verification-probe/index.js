import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-cordis-devtools-e2e-runtime-verification-probe'

export const VERIFICATION_EVENT = 'cordis-devtools-e2e/runtime-verification-duplicate'
export const VERIFICATION_FIBER_NAME = 'cordis-devtools-e2e-runtime-verification-plugin'
export const TRANSITION_FILENAME = 'cordis-devtools-e2e-runtime-verification-transition'

function duplicatePlugin() {
  return {
    name: VERIFICATION_FIBER_NAME,
    apply(pluginCtx) {
      pluginCtx.on(VERIFICATION_EVENT, () => undefined)
      pluginCtx.effect(() => {
        const timer = setInterval(() => {
          pluginCtx.emit(VERIFICATION_EVENT)
        }, 250)
        return () => { clearInterval(timer) }
      }, 'dsh-cordis-devtools e2e runtime verification dispatch probe')
    },
  }
}

export async function apply(ctx) {
  await ctx.effect(async () => {
    const first = await ctx.plugin(duplicatePlugin())
    let second = await ctx.plugin(duplicatePlugin())
    const transitionFile = process.env.DSH_HOME
      ? join(process.env.DSH_HOME, TRANSITION_FILENAME)
      : null

    console.log(`[cordis-devtools-e2e] runtime verification baseline ready: ${first.uid},${second.uid}`)

    const transitionTimer = setInterval(() => {
      if (!transitionFile || !second || !existsSync(transitionFile)) return
      const disposing = second
      second = null
      clearInterval(transitionTimer)
      void disposing.dispose().then(() => {
        console.log(`[cordis-devtools-e2e] runtime verification transition complete: kept ${first.uid}`)
      })
    }, 100)

    return async () => {
      clearInterval(transitionTimer)
      const pending = second
      second = null
      await Promise.allSettled([
        ...(pending ? [pending.dispose()] : []),
        first.dispose(),
      ])
    }
  }, 'dsh-cordis-devtools e2e runtime verification fixture')
}
