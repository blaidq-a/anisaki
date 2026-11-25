import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The phone / TV app (Tauri on Android) reuses the desktop UI (src/renderer) and its window.api
// (src/renderer/src/desktop/api.ts); Node and Electron pieces of src/main are swapped for the desktop's
// stand-ins (src/renderer/src/desktop/shims). Built with the root project's packages.
const root = path.resolve(__dirname, '..')
const shims = path.resolve(root, 'src/renderer/src/desktop/shims')
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    react(),
    {
      name: 'anisaki-mobile-shims',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === 'electron') return path.join(shims, 'electron.ts')
        if (id === 'node:fs' || id === 'fs') return path.join(shims, 'fs.ts')
        if (id === 'node:path' || id === 'path') return path.join(shims, 'path.ts')
        if (id === 'node:crypto' || id === 'crypto') return path.join(shims, 'crypto.ts')
        if (id === './embedded' && importer?.split('\\').join('/').includes('/src/main/')) return path.join(shims, 'embedded.ts')
        return null
      }
    }
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [root] } },
  worker: { format: 'es' },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 4000, target: 'es2022' }
})
