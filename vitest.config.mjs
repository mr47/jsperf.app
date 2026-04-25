import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{ts,tsx,js,mjs}'],
    coverage: {
      provider: 'v8',
      include: [
        'components/report/slideUtils.{js,ts}',
        'utils/**/*.{js,ts,jsx,tsx}',
        'lib/engines/**/*.{js,ts}',
        'lib/prediction/**/*.{js,ts}',
        'lib/benchmark/**/*.{js,ts}',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(dir, '.'),
    },
  },
})
