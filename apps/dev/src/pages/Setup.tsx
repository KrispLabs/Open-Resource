import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useToast } from '../components/Toast'
import type { Provider } from '../api/providers'
import { listProviders, configureProvider } from '../api/providers'
import { api } from '../api/client'

function ProviderForm({
  provider,
  onSuccess,
  onSkip,
  canSkip,
}: {
  provider: Provider
  onSuccess: (id: string) => void
  onSkip?: () => void
  canSkip: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {}
    for (const f of provider.fields) {
      defaults[f.key] = f.default ?? ''
    }
    return defaults
  })
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<{ healthy: boolean; message: string } | null>(
    provider.health
  )
  const { showToast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await configureProvider(provider.id, values)
      setHealth(result.health)
      if (result.health.healthy) {
        onSuccess(provider.id)
      } else {
        showToast(`${provider.name}: ${result.health.message}`, 'error')
      }
    } catch {
      showToast(`Failed to configure ${provider.name}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{provider.name}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{provider.description}</div>
        </div>
        {health !== null && (
          <span style={{
            fontSize: '12px', padding: '2px 8px', borderRadius: '4px', fontWeight: 600,
            backgroundColor: health.healthy ? 'var(--color-success-dim)' : 'var(--color-danger-dim)',
            color: health.healthy ? 'var(--color-success)' : 'var(--color-danger)',
          }}>
            {health.healthy ? '✓ Connected' : '✗ Failed'}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        {provider.fields.map(field => (
          <div key={field.key} className="form-group" style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              {field.label}{field.required && ' *'}
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                className="form-input"
                type={field.type === 'secret' && !show[field.key] ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                placeholder={field.type === 'secret' ? '••••••••••••' : field.default ?? ''}
                required={field.required}
                style={{ flex: 1, fontFamily: field.type === 'secret' ? 'var(--font-mono)' : undefined }}
              />
              {field.type === 'secret' && (
                <button
                  type="button"
                  onClick={() => setShow(s => ({ ...s, [field.key]: !s[field.key] }))}
                  style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)' }}
                >
                  {show[field.key] ? 'hide' : 'show'}
                </button>
              )}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </button>
          {canSkip && onSkip && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip}>
              Skip for now
            </button>
          )}
        </div>

        {health && !health.healthy && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-danger)' }}>
            {health.message}
          </div>
        )}
      </form>
    </div>
  )
}

export default function Setup() {
  const [step, setStep] = useState<'login' | 'required' | 'optional' | 'complete'>('login')
  const [providers, setProviders] = useState<Provider[]>([])
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())
  const [loginEmail, setLoginEmail] = useState('admin@openresource.com')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (step !== 'login') {
      listProviders().then(setProviders).catch(() => {})
    }
  }, [step])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const { data: tokenData } = await api.post('/auth/login', {
        email: loginEmail,
        password: loginPassword,
      })
      if (tokenData.role !== 'dev') {
        setLoginError('Admin (dev) credentials required for setup.')
        setLoginLoading(false)
        return
      }
      const { data: userData } = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      setAuth(tokenData.access_token, userData)
      setStep('required')
    } catch {
      setLoginError('Invalid credentials. Use admin@openresource.com / demo1234')
    } finally {
      setLoginLoading(false)
    }
  }

  const requiredProviders = providers.filter(p => p.required)
  const optionalProviders = providers.filter(p => !p.required)
  const allRequiredConnected = requiredProviders.every(p => connectedIds.has(p.id) || p.configured)

  const handleConnected = (id: string) => setConnectedIds(prev => new Set([...prev, id]))

  if (step === 'login') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-base)' }}>
        <div style={{ width: '400px', padding: '32px', backgroundColor: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border-default)' }}>
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Open Resource Setup
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Sign in with your admin account to configure infrastructure providers.
            </div>
          </div>
          <form onSubmit={handleLogin}>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Email</label>
              <input className="form-input" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required />
            </div>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Password</label>
              <input
                className="form-input"
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="demo1234"
                required
              />
            </div>
            {loginError && (
              <div style={{ fontSize: '12px', color: 'var(--color-danger)', marginBottom: '12px' }}>{loginError}</div>
            )}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loginLoading}>
              {loginLoading ? 'Signing in...' : 'Continue to Setup'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (step === 'complete') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-base)' }}>
        <div style={{ width: '480px', padding: '32px', backgroundColor: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border-default)', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)', marginBottom: '8px' }}>Setup Complete</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
            Your infrastructure is configured. The platform is ready.
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
            Launch Platform
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-base)', padding: '32px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)', marginBottom: '4px' }}>
            {step === 'required' ? 'Required Integrations' : 'Optional Integrations'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {step === 'required'
              ? 'These providers must be configured before the platform can operate.'
              : 'These providers extend platform capabilities. You can configure them later.'}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {(['required', 'optional'] as const).map(s => (
            <div key={s} style={{
              height: '3px', flex: 1, borderRadius: '2px',
              backgroundColor: step === s || (s === 'required' && step === 'optional')
                ? 'var(--color-primary)' : 'var(--border-default)',
            }} />
          ))}
        </div>

        {(step === 'required' ? requiredProviders : optionalProviders).map(p => (
          <ProviderForm
            key={p.id}
            provider={p}
            onSuccess={handleConnected}
            onSkip={() => {}}
            canSkip={!p.required}
          />
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          {step === 'required' && (
            <button
              className="btn btn-primary"
              disabled={!allRequiredConnected}
              onClick={() => setStep(optionalProviders.length > 0 ? 'optional' : 'complete')}
            >
              Next
            </button>
          )}
          {step === 'optional' && (
            <button className="btn btn-primary" onClick={() => setStep('complete')}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
