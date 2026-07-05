import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// Inicia la detección del backend en cuanto arranca la app (local → tunnel → cloud)
import { getApiUrl } from './lib/backendResolver'
getApiUrl().then(url => console.info(`[KokoMusic] Backend: ${url}`))

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // En dev con HMR el SW no es crítico
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
