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
const primitive = () => null
const uiPrimitives = {
  Button: primitive,
  DisclosureRow: primitive,
  IconCloseOutline16: primitive,
  IconCordisPluginOutline14: primitive,
  IconRefreshOutline16: primitive,
  IconSearchOutline16: primitive,
  Input: primitive,
  Pill: primitive,
  Tooltip: primitive,
  useDismissOnOutsidePointer() {},
}
let requestedPrimitives = false
const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return react
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    requestedPrimitives = true
    return uiPrimitives
  }
  throw new Error(`unexpected client external: ${specifier}`)
})

assert.equal(requestedPrimitives, true, 'client bundle did not resolve DSH UI primitives from the module table')
assert.equal(plugin.name, 'dsh-cordis-devtools')
assert.equal(typeof plugin.apply, 'function')
assert.ok(Array.isArray(plugin.inject))
assert.ok(plugin.inject.includes('slots'))
assert.ok(plugin.inject.includes('connection'))

console.log('verify-client-bundle: DSH module-loader registration and UI primitive external are executable')
