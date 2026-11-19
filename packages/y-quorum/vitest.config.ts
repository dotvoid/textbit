import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node'
  },
  resolve: {
    // Test against the editor's source, so nothing has to be built first
    alias: [
      { find: /^@dotvoid\/textbit\/headless$/, replacement: resolve(__dirname, '../textbit/lib/headless.ts') },
      { find: /^@dotvoid\/y-quorum-client\/(protocol|model)$/, replacement: resolve(__dirname, '../y-quorum-client/lib/$1.ts') },
      { find: /^@dotvoid\/y-quorum-client$/, replacement: resolve(__dirname, '../y-quorum-client/lib/index.ts') }
    ]
  }
})
