import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { bundleModuleMap } from './scripts/bundle-manifest.mjs'

export default defineConfig({
  plugins: [react(), bundleModuleMap()],
  server: { proxy: { '/api': 'http://127.0.0.1:5000' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    // Let the route import graph split shared libraries as needed. Combining
    // icons, charts and animation into one eager chunk loads unopened features.
  },
})
