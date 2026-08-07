import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import App from './App.tsx';
import './index.css';

// ─── Global error handlers ───────────────────────────────────
// Capture async errors and unhandled promise rejections that
// React ErrorBoundary cannot catch. This prevents silent failures
// in production POS terminals.
window.addEventListener('error', (event) => {
  // Ignore resource load failures (Event, not ErrorEvent)
  if (event instanceof ErrorEvent) {
    console.error('[Global] Uncaught error:', event.error?.message || event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Unhandled rejection:', event.reason?.message || event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
