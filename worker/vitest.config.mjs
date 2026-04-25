import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,js}'],
    coverage: {
      provider: 'v8',
      include: ['complexity/**/*.{ts,js}', 'runtimes/**/*.{ts,js}', '*.ts'],
    },
  },
})
