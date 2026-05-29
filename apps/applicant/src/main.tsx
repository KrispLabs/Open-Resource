import React from 'react'
import ReactDOM from 'react-dom/client'
import { initDiagnostics } from '@open-resource/shared'
import App from './App'
import './index.css'

// Apply saved theme before first render to avoid flash
const savedTheme = localStorage.getItem('or_theme')
if (savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', 'light')
}

// Dev-only diagnostics — captured to window.OR_DIAGNOSTICS, no-op in production
if (import.meta.env.DEV) {
  initDiagnostics('applicant')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
