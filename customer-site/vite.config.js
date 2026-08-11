import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // QR Studio bakes this origin into stickers via QR_BASE_URL (default).
    port: 5177,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
  },
})
