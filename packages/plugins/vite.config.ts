import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Everything the package depends on, the editor included, stays an import for
// the host to resolve, so there is one copy of each.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
const packages = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })
const isExternal = (id: string) => packages.some((name) => id === name || id.startsWith(`${name}/`))

export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: './tsconfig.lib.json',
      entryRoot: 'lib',
      // Keep `from '@dotvoid/textbit'` in the declarations instead of the
      // source path that tsconfig maps it to for type checking
      pathsToAliases: false,
      exclude: ['tests/**']
    })
  ],
  publicDir: false,
  build: {
    lib: {
      entry: resolve(__dirname, 'lib/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: isExternal,
      output: {
        // One output file per source module, so a bundler drops every plugin
        // a host does not import, in ESM and CommonJS alike
        preserveModules: true,
        preserveModulesRoot: 'lib'
      }
    }
  }
})
