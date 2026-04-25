import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{js,mjs}'],
    coverage: {
      provider: 'v8',
      include: [
        'components/report/slideUtils.js',
        'utils/**/*.js',
        'lib/engines/**/*.js',
        'lib/prediction/**/*.js',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(dir, '.'),
    },
  },
})
