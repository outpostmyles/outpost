import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './hooks/useAuth.jsx';
import App from './pages/App.jsx';
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>
);

// Register the PWA service worker — enables Add-to-Home-Screen on mobile and
// install-as-app on Chromium desktop. Skips on dev (Vite) to avoid stale-cache
// confusion during local development.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('[SW] register failed:', err.message);
    });
  });
}
