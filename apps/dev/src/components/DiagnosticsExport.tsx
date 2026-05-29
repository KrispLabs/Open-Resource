import { Download } from 'lucide-react'
import { exportDiagnostics } from '@open-resource/shared'

export function DiagnosticsExport() {
  if (!import.meta.env.DEV) return null

  function handleExport() {
    const snapshot = exportDiagnostics()
    if (!snapshot) return
    const json = JSON.stringify(snapshot, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `or-diagnostics-${snapshot.portal}-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      title="Export diagnostics snapshot for AI-assisted debugging"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '4px 10px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '4px',
        cursor: 'pointer',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <Download size={12} />
      Export Diagnostics
    </button>
  )
}
