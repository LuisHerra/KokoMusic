import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// VITE_BUILD_MODE=local → build sin base path, para servir desde localhost:3001
const isLocal = process.env.VITE_BUILD_MODE === 'local';

export default defineConfig({
  plugins: [react()],
  base: isLocal ? '/' : '/kokoMusic/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    host: true,
    hmr: {
      protocol: 'ws',
      port: 5173,
    },
  },
})

