import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Loader2 } from 'lucide-react'
import { useToast } from '../components/Toast'

function extractErrorMsg(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.length > 0) return detail
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; message?: string } | undefined
    return first?.msg ?? first?.message ?? fallback
  }
  return fallback
}

const CATEGORIES = [
  { key: 'technical_skills', label: 'Technical Skills' },
  { key: 'experience', label: 'Experience' },
  { key: 'projects', label: 'Projects' },
  { key: 'education', label: 'Education' },
  { key: 'communication', label: 'Communication' },
] as const

type WeightKey = typeof CATEGORIES[number]['key']
type Weights = Record<WeightKey, number>

interface JobData {
  title: string
  scoring_weights?: Weights
  jd_parsed?: {
    proposed_weights?: Weights
    weight_reasoning?: string
  }
}

const DEFAULT_WEIGHTS: Weights = {
  technical_skills: 40,
  experience: 25,
  projects: 20,
  education: 8,
  communication: 7,
}

function redistribute(weights: Weights, changedKey: WeightKey, newValue: number): Weights {
  const otherKeys = CATEGORIES.map(c => c.key).filter(k => k !== changedKey) as WeightKey[]
  const remaining = 100 - newValue
  const otherTotal = otherKeys.reduce((s, k) => s + weights[k], 0)

  let newWeights: Weights = { ...weights, [changedKey]: newValue }

  if (otherTotal === 0) {
    // Distribute evenly among others
    const share = Math.floor(remaining / otherKeys.length)
    const leftover = remaining - share * otherKeys.length
    otherKeys.forEach((k, i) => {
      newWeights[k] = share + (i === 0 ? leftover : 0)
    })
  } else {
    // Scale proportionally
    let allocated = 0
    otherKeys.forEach((k, i) => {
      if (i < otherKeys.length - 1) {
        const scaled = Math.round((weights[k] / otherTotal) * remaining)
        newWeights[k] = scaled
        allocated += scaled
      } else {
        // Last key gets the remainder to ensure exact sum of 100
        newWeights[k] = remaining - allocated
      }
    })
  }

  return newWeights
}

export default function WeightEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS)
  const [aiWeights, setAiWeights] = useState<Weights | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: job, isLoading } = useQuery<JobData>({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then(r => r.data),
  })

  useEffect(() => {
    if (job?.jd_parsed?.proposed_weights) {
      setAiWeights(job.jd_parsed.proposed_weights)
      setWeights(job.jd_parsed.proposed_weights)
    } else if (job?.scoring_weights) {
      setWeights(job.scoring_weights)
    }
  }, [job])

  const total = Object.values(weights).reduce((s, v) => s + v, 0)
  const isValid = Math.abs(total - 100) < 0.01

  const handleSlider = (key: WeightKey, val: number) => {
    setWeights(prev => redistribute(prev, key, val))
  }

  const handlePublish = async () => {
    if (!isValid) return
    setSaving(true)
    setError('')
    try {
      await api.post(`/jobs/${id}/publish`, { scoring_weights: weights })
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      showToast('Job published successfully!', 'success')
      navigate(`/jobs/${id}`)
    } catch (err: unknown) {
      const msg = extractErrorMsg(err, 'Failed to publish job')
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Scoring Weights</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {job?.title} — Adjust the weights then publish.
        </p>
      </div>

      {/* AI reasoning */}
      {job?.jd_parsed?.weight_reasoning && (
        <div
          className="mb-5 p-4 rounded-lg border-l-2 text-sm"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-primary)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-wide block mb-1"
            style={{ color: 'var(--color-primary)' }}
          >
            AI Reasoning
          </span>
          {job.jd_parsed.weight_reasoning}
        </div>
      )}

      <div
        className="p-6 rounded-lg border space-y-5"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-elevated)' }}
      >
        {CATEGORIES.map(({ key, label }) => {
          const aiVal = aiWeights?.[key]
          const userVal = weights[key]
          const differsFromAi = aiVal !== undefined && Math.abs(userVal - aiVal) >= 1

          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
                <div className="flex items-center gap-3">
                  {differsFromAi && (
                    <span
                      className="text-xs"
                      style={{ color: 'var(--color-text-muted)', fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      AI: {aiVal}% → You: {userVal}%
                    </span>
                  )}
                  <span
                    className="text-sm font-bold"
                    style={{ color: 'var(--color-primary)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {userVal}%
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={userVal}
                onChange={e => handleSlider(key, Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: 'var(--color-primary)' }}
              />
            </div>
          )
        })}

        {/* Total indicator */}
        <div
          className="flex items-center justify-between pt-3 border-t"
          style={{ borderColor: 'var(--color-elevated)' }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Total</span>
          <span
            className="text-sm font-bold"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: isValid ? 'var(--color-success)' : 'var(--color-danger)',
            }}
          >
            {total.toFixed(0)}%
          </span>
        </div>
        {!isValid && (
          <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
            Weights must total 100%. Currently at {total.toFixed(0)}%.
          </p>
        )}
      </div>

      {error && <p className="text-sm mt-3" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={handlePublish}
          disabled={!isValid || saving}
          className="px-5 py-2 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)', borderRadius: '6px' }}
        >
          {saving ? 'Publishing…' : 'Publish Job'}
        </button>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Back
        </button>
      </div>
    </div>
  )
}
