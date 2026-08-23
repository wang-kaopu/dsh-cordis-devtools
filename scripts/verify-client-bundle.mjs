import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import vm from 'node:vm'

const file = new URL('../lib/client.js', import.meta.url)
const source = readFileSync(file, 'utf8')
let registration

const sandbox = {
  console,
  AbortController,
  setInterval,
  clearInterval,
  window: {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  },
}

vm.runInNewContext(source, sandbox, { filename: file.pathname })

assert.ok(registration, 'client bundle did not register with window.__ModuleLoader__')
assert.equal(registration.id, 'dsh-cordis-devtools')
assert.equal(typeof registration.factory, 'function')

const react = {
  createElement() { return null },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(factory) { return factory() },
  useRef(value) { return { current: value } },
  useState(value) { return [value, () => {}] },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
}
const jsxRuntime = {
  Fragment: Symbol('Fragment'),
  jsx() { return null },
  jsxs() { return null },
}
const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return react
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  throw new Error(`unexpected client external: ${specifier}`)
})

assert.equal(plugin.name, 'dsh-cordis-devtools')
assert.equal(typeof plugin.apply, 'function')
assert.ok(Array.isArray(plugin.inject))
assert.ok(plugin.inject.includes('slots'))
assert.ok(plugin.inject.includes('connection'))

console.log('verify-client-bundle: DSH module-loader registration is executable')
