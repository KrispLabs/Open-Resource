import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initDiagnostics } from '@open-resource/shared'
import './index.css'
import App from './App.tsx'

// Inject Google Fonts
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
document.head.appendChild(link)

// Dev-only diagnostics — captured to window.OR_DIAGNOSTICS, no-op in production
if (import.meta.env.DEV) {
  initDiagnostics('hr')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
