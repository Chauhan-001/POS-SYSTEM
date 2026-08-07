import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Large charting library — already lazy-loaded via React.lazy()
          if (id.includes('node_modules/recharts')) return 'vendor-charts'
          // React ecosystem
          if (id.includes('node_modules/react-dom')) return 'vendor-react-dom'
          if (id.includes('node_modules/react') && !id.includes('react-router')) return 'vendor-react'
          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) return 'vendor-router'
          // Data fetching and forms
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query'
          // Icon library
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons'
          // Utility libraries
          if (id.includes('node_modules/axios')) return 'vendor-http'
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})
