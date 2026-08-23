import { defineConfig } from 'tsdown'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
]

export default defineConfig([
  {
    name: 'dsh-cordis-devtools',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: true,
    clean: true,
    external: ['@deepseek-ai/cordis'],
  },
  {
    name: 'dsh-cordis-devtools/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    external: CLIENT_EXTERNALS,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-cordis-devtools", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
