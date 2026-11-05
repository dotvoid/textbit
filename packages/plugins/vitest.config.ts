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
    alias: {
      '@dotvoid/textbit': resolve(__dirname, '../textbit/lib/main.ts')
    }
  }
})
