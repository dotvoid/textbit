import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Run against the packages' source, so a change shows without building them.
// A real host imports the published packages instead.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@dotvoid/textbit-plugins': resolve(__dirname, '../../packages/plugins/lib/index.ts'),
      '@dotvoid/textbit': resolve(__dirname, '../../packages/textbit/lib/main.ts')
    },
    dedupe: ['react', 'react-dom', 'slate', 'slate-react']
  }
})
