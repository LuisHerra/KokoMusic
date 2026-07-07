import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// Inicia la detección del backend en cuanto arranca la app (local → tunnel → cloud)
import { getApiUrl } from './lib/backendResolver'
getApiUrl().then(url => console.info(`[KokoMusic] Backend: ${url}`))

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        // En dev con HMR el SW no es crítico
      });
    });
  } else {
    // Desregistrar activamente el service worker en desarrollo para evitar conflictos con HMR y manifest.json
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then((success) => {
          if (success) console.info('[KokoMusic] Service Worker desregistrado con éxito para desarrollo.');
        });
      }
    }).catch(err => console.warn('[KokoMusic] Error al desregistrar Service Worker:', err));
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
