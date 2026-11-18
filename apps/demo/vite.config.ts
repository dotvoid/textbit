import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Run against the packages' source, so a change shows without building them.
// A real host imports the published packages instead.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Exact matches, so each package's second entry resolves to its own source
    alias: [
      { find: /^@dotvoid\/textbit-plugins$/, replacement: resolve(__dirname, '../../packages/plugins/lib/index.ts') },
      { find: /^@dotvoid\/textbit-plugins\/definitions$/, replacement: resolve(__dirname, '../../packages/plugins/lib/definitions.ts') },
      { find: /^@dotvoid\/textbit$/, replacement: resolve(__dirname, '../../packages/textbit/lib/main.ts') },
      { find: /^@dotvoid\/textbit\/headless$/, replacement: resolve(__dirname, '../../packages/textbit/lib/headless.ts') }
    ],
    dedupe: ['react', 'react-dom', 'slate', 'slate-react']
  }
})
