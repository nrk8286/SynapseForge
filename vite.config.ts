import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3101',
      '/uploads': 'http://127.0.0.1:3101',
      '/socket.io': {
        target: 'ws://127.0.0.1:3101',
        ws: true,
      },
    },
  },
  build: {
    sourcemap: false,
  },
})