import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The desktop UI (src/renderer) for the Tauri shell. Like the phone build, the addon / debrid / settings
// code from src/main runs in the WebView, with Node and Electron pieces swapped for stand-ins
// (src/renderer/src/desktop/shims); native work (mpv, files, torrents, translation) is done in Rust.
const shims = path.resolve(__dirname, 'src/renderer/src/desktop/shims')
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    {
      name: 'anisaki-desktop-shims',
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
  clearScreen: false,
  server: { port: 5173, strictPort: true, fs: { allow: [path.resolve(__dirname)] } },
  worker: { format: 'es' },
  build: { outDir: path.resolve(__dirname, 'dist-web'), emptyOutDir: true, chunkSizeWarningLimit: 4000, target: 'es2022' }
})
