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
  },
})
