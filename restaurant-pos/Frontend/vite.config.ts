/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * Production Content-Security-Policy, injected ONLY into the built index.html
 * (never applied in dev, so Vite HMR / inline scripts / ws:// keep working).
 *
 * The packaged Electron app loads the build via loadFile() → file:// origin,
 * so 'self' resolves to the app's own directory. External origins are
 * explicitly whitelisted: Google Fonts (preconnect + CSS + woff2) and the
 * Razorpay checkout script/iframe (SubscriptionSettings injects checkout.js).
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* https:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/** Vite plugin: add the CSP meta tag to the built index.html only. */
function injectProdCsp(): Plugin {
  return {
    name: 'inject-prod-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta name="theme-color" content="#191b23" />',
        `<meta name="theme-color" content="#191b23" />\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
      );
    },
  };
}

export default defineConfig(async () => {
  // Bundle visualizer — activated via VISUALIZE=true npm run build
  // Generates dist/stats.html for interactive bundle composition analysis
  // Dynamic import ensures the package is optional; skip if not installed.
  const visualizePlugin = process.env.VISUALIZE
    ? (await import('rollup-plugin-visualizer')).default({ filename: 'dist/stats.html', open: true })
    : null;

  return {
    // Relative asset base: the packaged app loads the build via loadFile()
    // (file:// protocol), where absolute /assets/ paths resolve to the
    // filesystem root and break. './' keeps every bundle path relative to the
    // built index.html, so file:// loading works (and http:// serving too).
    base: './',
    plugins: [react(), tailwindcss(), visualizePlugin, injectProdCsp()].filter(Boolean),
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      exclude: ['e2e/**', 'node_modules/**'],
      // Threads pool times out on some Windows setups (jsdom worker never
      // responds). Forks are more reliable for Electron-targeted projects.
      pool: 'forks',
      // On loaded Windows boxes spawning N fork workers at once can exceed the
      // worker-startup timeout. Cap parallelism to keep the suite reliable.
      maxWorkers: 1,
      minWorkers: 1,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Source maps only in development
      sourcemap: process.env.NODE_ENV !== 'production',
      // Target modern browsers (Electron, Chrome) for smaller output
      target: 'es2022',
      // CSS code splitting — separate CSS per entry/lazy chunk
      cssCodeSplit: true,
      // Suppress false-positive warning for vendor-charts (403 kB).
      // recharts is lazy-loaded only when visiting Analytics/Reports,
      // so the raw size is irrelevant for initial load performance.
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          // Function form for manualChunks to properly split vendor code.
          // Order matters: check most-specific paths first.
          manualChunks(id) {
            // ── React core split: react-dom changes less often than react ──
            if (id.includes('node_modules/react-dom')) {
              return 'vendor-react-dom';
            }
            if (id.includes('node_modules/react') && !id.includes('react-router')) {
              return 'vendor-react';
            }
            // ── Routing ──
            if (id.includes('node_modules/react-router')) {
              return 'vendor-router';
            }
            // ── Animation (motion/framer-motion) used in ~25 components ──
            if (id.includes('node_modules/motion')) {
              return 'vendor-motion';
            }
            // ── Charts (recharts is very heavy ~400KB) — lazy-loaded ──
            if (id.includes('node_modules/recharts')) {
              return 'vendor-charts';
            }
            // ── DnD kit — only used in ProductManager (drag-reorder) ──
            if (id.includes('node_modules/@dnd-kit')) {
              return 'vendor-dnd';
            }
            // ── Icons — lucide-react tree-shakes, but the resolved module is large ──
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-icons';
            }
            // ── HTTP client ──
            if (id.includes('node_modules/axios')) {
              return 'vendor-http';
            }
            // ── Floating UI — only used in guided tour position engine ──
            if (id.includes('node_modules/@floating-ui')) {
              return 'vendor-tour';
            }
          },
        },
      },
    },
    server: {
      port: 5175,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
      },
    },
  };
});
