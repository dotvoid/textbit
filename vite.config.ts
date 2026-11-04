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
      entry: resolve(__dirname, 'lib/main.ts'),
      name: 'Textbit',
      // .cjs so Node loads the UMD build as CommonJS: with "type": "module" a
      // .js file is read as an ES module and require() got an empty object
      fileName: (format) => format === 'umd' ? 'index.umd.cjs' : `index.${format}.js`
    },
    rollupOptions: {
      external: isExternal,
      output: {
        globals: {
          'react': 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJSXRuntime',
          'slate': 'Slate',
          'slate-react': 'SlateReact',
          'slate-history': 'SlateHistory',
          'yjs': 'Y',
          '@slate-yjs/core': 'SlateYjsCore',
          '@slate-yjs/react': 'SlateYjsReact',
          'y-protocols/awareness': 'YProtocolsAwareness',
          'is-hotkey': 'IsHotkey'
        }
      }
    }
  }
})
