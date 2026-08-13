import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // QR Studio bakes this origin into stickers via QR_BASE_URL (default).
    port: 5177,
    // Serve on 0.0.0.0 so phones on the LAN can scan the QR sticker and
    // reach this dev server (auto-detected LAN IP is baked into stickers).
    host: true,
    // The baked sticker URL always points at :5177 — fail loudly instead of
    // silently drifting to another port and breaking every printed QR.
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
})
