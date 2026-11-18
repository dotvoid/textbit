import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Everything the package depends on is left for the host to install, never
// copied into dist: a bundled copy of a peer like @slate-yjs/core would sit
// next to the host's own and the two would not know about each other.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
const packages = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })
const isExternal = (id: string) => packages.some((name) => id === name || id.startsWith(`${name}/`))

export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: './tsconfig.lib.json',
      insertTypesEntry: true,
      include: ['lib/**/*'],
      exclude: ['**/*.test.*', '**/*.spec.*']
    })
  ],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'slate',
      'slate-react',
      'slate-history',
      '@slate-yjs/core',
      '@slate-yjs/react',
      'yjs'
    ]
  },
  publicDir: false,
  build: {
    lib: {
      // The editor, and the same without a user interface
      entry: {
        index: resolve(__dirname, 'lib/main.ts'),
        headless: resolve(__dirname, 'lib/headless.ts')
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: isExternal
    }
  }
})
