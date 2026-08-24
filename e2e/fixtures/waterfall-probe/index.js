export const name = 'dsh-cordis-devtools-e2e-probe'

export function apply(ctx) {
  ctx.on('cordis-devtools-e2e/probe', (_tick, next) => next())

  ctx.effect(() => {
    const timer = setInterval(() => {
      ctx.waterfall('cordis-devtools-e2e/probe', Date.now(), () => 'probe-complete')
    }, 250)
    return () => { clearInterval(timer) }
  }, 'dsh-cordis-devtools e2e waterfall probe')
}
