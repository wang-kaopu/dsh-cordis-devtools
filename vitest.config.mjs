import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': new URL(
        './tests/ui-primitives.stub.tsx',
        import.meta.url,
      ).pathname,
    },
  },
})
