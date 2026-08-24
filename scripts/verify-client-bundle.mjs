import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import vm from 'node:vm'

const file = new URL('../lib/client.js', import.meta.url)
const source = readFileSync(file, 'utf8')
let registration
const styleTags = []

const document = {
  querySelector(selector) {
    return styleTags.find(tag => selector.includes(JSON.stringify(tag.dataset.pluginCss))) ?? null
  },
  createElement(tagName) {
    assert.equal(tagName, 'style')
    return { dataset: {}, textContent: '' }
  },
  head: {
    appendChild(tag) {
      styleTags.push(tag)
    },
  },
}

const sandbox = {
  console,
  AbortController,
  setInterval,
  clearInterval,
  document,
  window: {
    document,
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

const injectedCssIds = styleTags.map(tag => tag.dataset.pluginCss)
assert.deepEqual(
  [...injectedCssIds].sort(),
  [
    'dsh-cordis-devtools/src/client/DetailList.module.css',
    'dsh-cordis-devtools/src/client/DevtoolsPanel.module.css',
    'dsh-cordis-devtools/src/client/views/ProfilerView.module.css',
  ].sort(),
  'client bundle did not inject each CSS Module with a distinct style tag',
)
assert.equal(new Set(injectedCssIds).size, injectedCssIds.length, 'client CSS Module style ids are not unique')
assert.ok(styleTags.every(tag => tag.textContent.length > 0), 'client CSS Module emitted an empty style tag')

assert.equal(requestedPrimitives, true, 'client bundle did not resolve DSH UI primitives from the module table')
assert.equal(plugin.name, 'dsh-cordis-devtools')
assert.equal(typeof plugin.apply, 'function')
assert.ok(Array.isArray(plugin.inject))
assert.ok(plugin.inject.includes('slots'))
assert.ok(plugin.inject.includes('connection'))

console.log('verify-client-bundle: DSH module-loader registration, UI primitive external, and CSS Module injection are executable')
