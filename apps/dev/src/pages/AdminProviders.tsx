import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import type { Provider } from '../api/providers'
import {
  listProviders,
  validateProvider,
  rotateProvider,
  disableProvider,
} from '../api/providers'

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':    return 'var(--color-success)'
    case 'unhealthy':  return 'var(--color-danger)'
    case 'configured': return 'var(--color-warning)'
    default:           return 'var(--text-muted)'
  }
}

function RotateModal({
  provider,
  onClose,
  onSuccess,
}: {
  provider: Provider
  onClose: () => void
  onSuccess: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {}
    for (const f of provider.fields) d[f.key] = f.default ?? ''
    return d
  })
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<{ healthy: boolean; message: string } | null>(null)
  const { showToast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await rotateProvider(provider.id, values)
      setHealth(result.health)
      if (result.health.healthy) {
        showToast(`${provider.name} credentials rotated successfully`, 'success')
        onSuccess()
      } else {
        showToast(`Validation failed: ${result.health.message}`, 'error')
      }
    } catch {
      showToast('Rotation failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ width: '440px', backgroundColor: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border-default)', padding: '24px' }}>
        <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '16px', color: 'var(--text-primary)' }}>
          Rotate — {provider.name}
        </div>
        <form onSubmit={handleSubmit}>
          {provider.fields.map(f => (
            <div key={f.key} className="form-group" style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                {f.label}{f.required && ' *'}
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  className="form-input"
                  type={f.type === 'secret' && !show[f.key] ? 'password' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.type === 'secret' ? '••••••••' : f.default ?? ''}
                  required={f.required}
                  style={{ flex: 1, fontFamily: f.type === 'secret' ? 'var(--font-mono)' : undefined }}
                />
                {f.type === 'secret' && (
                  <button
                    type="button"
                    onClick={() => setShow(s => ({ ...s, [f.key]: !s[f.key] }))}
                    style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)' }}
                  >
                    {show[f.key] ? 'hide' : 'show'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {health && (
            <div style={{ fontSize: '12px', marginTop: '8px', color: health.healthy ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {health.healthy ? '✓ Credentials valid' : `✗ ${health.message}`}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
              {loading ? 'Saving...' : 'Save & Test'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminProviders() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [rotatingProvider, setRotatingProvider] = useState<Provider | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: listProviders,
  })

  const handleTest = async (p: Provider) => {
    try {
      const h = await validateProvider(p.id)
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      showToast(`${p.name}: ${h.message}`, h.healthy ? 'success' : 'error')
    } catch {
      showToast(`Test failed for ${p.name}`, 'error')
    }
  }

  const handleDisable = async (p: Provider) => {
    if (!confirm(`Disable ${p.name}? Services relying on it will fall back or fail.`)) return
    try {
      await disableProvider(p.id)
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      showToast(`${p.name} disabled`, 'warning')
    } catch {
      showToast('Disable failed', 'error')
    }
  }

  if (isLoading) {
    return <div style={{ padding: '24px', color: 'var(--text-muted)' }}>Loading providers…</div>
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Infrastructure Providers
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Manage credentials for external services. Secrets are stored AES-256 encrypted server-side and never exposed via this interface.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {providers.map(p => (
          <div key={p.id} style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '16px',
          }}>
            {/* Status indicator */}
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              backgroundColor: statusColor(p.status),
              marginTop: '6px', flexShrink: 0,
            }} />

            {/* Provider info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{p.name}</span>
                {p.required && (
                  <span style={{
                    fontSize: '10px', fontWeight: 600, color: 'var(--color-primary)',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>required</span>
                )}
                <span style={{ fontSize: '11px', color: statusColor(p.status), fontWeight: 500 }}>{p.status}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{p.description}</div>

              {/* Field summary — show labels + masked values, never actual secrets */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                {p.fields.map(f => (
                  <span key={f.key} style={{
                    fontSize: '11px', padding: '1px 6px', borderRadius: '3px',
                    backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {f.label}: {f.type === 'secret' ? (p.configured ? '••••••••' : 'not set') : (f.default ?? '—')}
                  </span>
                ))}
              </div>

              {/* Health status */}
              {p.health && (
                <div style={{ fontSize: '11px', color: p.health.healthy ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  Last checked: {new Date(p.health.last_checked).toLocaleString()} — {p.health.message}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleTest(p)} title="Test connection">
                Test
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRotatingProvider(p)} title="Rotate credentials">
                Rotate
              </button>
              {p.configured && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDisable(p)}
                  style={{ color: 'var(--color-danger)' }}
                  title="Disable provider"
                >
                  Disable
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {rotatingProvider && (
        <RotateModal
          provider={rotatingProvider}
          onClose={() => setRotatingProvider(null)}
          onSuccess={() => {
            setRotatingProvider(null)
            queryClient.invalidateQueries({ queryKey: ['providers'] })
          }}
        />
      )}
    </div>
  )
}
