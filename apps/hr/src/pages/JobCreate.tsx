import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Loader2, Sparkles } from 'lucide-react'
import { useToast } from '../components/Toast'

const inputClass = 'w-full px-3 py-2 rounded text-sm border outline-none'
const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-elevated)',
  borderColor: 'var(--color-elevated)',
  color: 'var(--color-text-primary)',
}
const labelStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontSize: '13px',
  fontWeight: 500,
  marginBottom: '6px',
  display: 'block',
}

export default function JobCreate() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    job_type: 'remote',
    application_deadline: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.description.trim().split(/\s+/).length < 50) {
      const msg = 'Please provide a more detailed job description (minimum 100 words).'
      setError(msg)
      showToast(msg, 'error')
      return
    }
    setLoading(true)
    try {
      const payload: Record<string, unknown> = { ...form }
      if (!form.application_deadline) delete payload.application_deadline
      const { data: job } = await api.post('/jobs', payload)

      // Immediately trigger JD analysis
      setAnalyzing(true)
      try {
        await api.post(`/jobs/${job.id}/analyze`)
      } catch {
        // Analysis failed — still navigate to weights page, HR can re-analyze
      }
      navigate(`/jobs/${job.id}/weights`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to create job'
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
      setAnalyzing(false)
    }
  }

  const wordCount = form.description.trim().split(/\s+/).filter(Boolean).length

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Post a New Job</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          AI will analyze your job description and propose scoring weights.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div
          className="p-6 rounded-lg border space-y-4"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-elevated)' }}
        >
          <div>
            <label style={labelStyle}>Job Title</label>
            <input
              value={form.title}
              onChange={set('title')}
              className={inputClass}
              style={inputStyle}
              placeholder="e.g. Senior Backend Engineer"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>Location</label>
              <input
                value={form.location}
                onChange={set('location')}
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. Remote, NYC"
              />
            </div>
            <div>
              <label style={labelStyle}>Job Type</label>
              <select value={form.job_type} onChange={set('job_type')} className={inputClass} style={inputStyle}>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">Onsite</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Application Deadline</label>
            <input
              type="datetime-local"
              value={form.application_deadline}
              onChange={set('application_deadline')}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>
              Job Description
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
                — minimum 50 words for AI analysis
              </span>
            </label>
            <textarea
              value={form.description}
              onChange={set('description')}
              className={inputClass}
              style={{ ...inputStyle, minHeight: '180px', resize: 'vertical' }}
              placeholder="Describe the role, responsibilities, required skills, and experience…"
              required
            />
            <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {wordCount} / 50 words minimum
            </div>
          </div>
        </div>

        {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || analyzing}
            className="flex items-center gap-2 px-5 py-2 rounded text-sm font-semibold text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)', borderRadius: '6px' }}
          >
            {(loading || analyzing) ? (
              <><Loader2 size={14} className="animate-spin" /> {analyzing ? 'Analyzing JD…' : 'Creating…'}</>
            ) : (
              <><Sparkles size={14} /> Analyze JD</>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
