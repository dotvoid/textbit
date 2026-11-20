import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Everything the package depends on stays an import for the host to resolve,
// so there is one copy of each
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
const packages = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })
const isExternal = (id: string) => id.startsWith('node:') || packages.some((name) => id === name || id.startsWith(`${name}/`))

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.lib.json',
      entryRoot: 'lib',
      pathsToAliases: false,
      exclude: ['tests/**']
    })
  ],
  publicDir: false,
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'lib/index.ts'),
        mcp: resolve(__dirname, 'lib/mcp/index.ts')
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: isExternal
    }
  }
})
