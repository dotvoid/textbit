import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: '../textbit/tests/_vitest.setup.ts'
  },
  resolve: {
    // Test against the editor's source, so nothing has to be built first
    alias: [
      { find: /^@dotvoid\/textbit$/, replacement: resolve(__dirname, '../textbit/lib/main.ts') },
      { find: /^@dotvoid\/textbit\/headless$/, replacement: resolve(__dirname, '../textbit/lib/headless.ts') }
    ]
  }
})
