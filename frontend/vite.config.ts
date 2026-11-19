import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Go API owns :8131 in dev; production serves /api/* through Caddy.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8131',
        changeOrigin: false,
      },
    },
  },
  // `vite preview` serves dist/ exactly like Caddy does, including /api.
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8131',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // Keep the modulepreload links for the entry's own deps (react), but drop
    // the polyfill — every browser that runs es2022 ships modulepreload, and
    // the polyfill module is one more thing to ship on the critical path.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // The room is the only thing that needs three.js. Keep the renderer and
        // React in their own long-lived chunks so a UI change does not force a
        // re-download of the 3D engine (and vice versa), and so the browser can
        // fetch them in parallel with the app code.
        manualChunks(id: string) {
          // Vite's preload helper is shared by the entry and the scene chunk;
          // left alone Rollup files it under `three`, which drags the whole 3D
          // engine back into the first paint. Park it with React instead — the
          // entry loads that chunk anyway.
          if (id.includes('vite/preload-helper')) return 'react'
          if (!id.includes('node_modules')) return
          if (/node_modules\/(three|three-[^/]+)\//.test(id)) return 'three'
          if (id.includes('node_modules/@react-three/')) return 'three'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
