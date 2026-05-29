import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initDiagnostics } from '@open-resource/shared'
import './index.css'
import App from './App.tsx'

// Apply saved theme before first render to avoid flash
const savedTheme = localStorage.getItem('or_theme') ?? 'dark'
if (savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', 'light')
} else {
  document.documentElement.removeAttribute('data-theme')
}

// Inject Google Fonts
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
document.head.appendChild(link)

// Dev-only diagnostics — captured to window.OR_DIAGNOSTICS, no-op in production
if (import.meta.env.DEV) {
  initDiagnostics('dev')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
