import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { formatDateTime } from '../utils/time'
import { useToast } from '../components/Toast'
import { Skeleton } from '../components/Skeleton'

interface ScoringWeights {
  technical_skills: number
  experience: number
  projects: number
  education: number
  communication: number
}

interface ScoringConfigResponse {
  id: string
  label: string
  weights: ScoringWeights
  is_default: boolean
  updated_at: string
}

const WEIGHT_LABELS: { key: keyof ScoringWeights; label: string }[] = [
  { key: 'technical_skills', label: 'Technical Skills' },
  { key: 'experience', label: 'Experience' },
  { key: 'projects', label: 'Projects' },
  { key: 'education', label: 'Education' },
  { key: 'communication', label: 'Communication' },
]

function redistribute(
  weights: ScoringWeights,
  changedKey: keyof ScoringWeights,
  newVal: number
): ScoringWeights {
  const clampedVal = Math.max(0, Math.min(100, newVal))
  const others = WEIGHT_LABELS.map(w => w.key).filter(k => k !== changedKey) as (keyof ScoringWeights)[]
  const remaining = 100 - clampedVal
  const currentOtherSum = others.reduce((s, k) => s + weights[k], 0)

  const newWeights: ScoringWeights = { ...weights, [changedKey]: clampedVal }

  if (currentOtherSum === 0) {
    const each = Math.floor(remaining / others.length)
    let leftover = remaining - each * others.length
    others.forEach((k, i) => {
      newWeights[k] = each + (i === 0 ? leftover-- : 0)
    })
  } else {
    let distributed = 0
    others.forEach((k, i) => {
      if (i < others.length - 1) {
        const share = Math.round((weights[k] / currentOtherSum) * remaining)
        newWeights[k] = share
        distributed += share
      } else {
        newWeights[k] = remaining - distributed
      }
    })
  }

  return newWeights
}

export default function ScoringConfig() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [weights, setWeights] = useState<ScoringWeights | null>(null)

  const { data: config, isLoading } = useQuery<ScoringConfigResponse>({
    queryKey: ['dev-scoring-config'],
    queryFn: () => api.get('/api/dev/scoring-config').then(r => r.data),
  })

  useEffect(() => {
    if (config && !weights) {
      setWeights(config.weights)
    }
  }, [config, weights])

  const mutation = useMutation({
    mutationFn: (w: ScoringWeights) =>
      api.patch('/api/dev/scoring-config', { weights: w }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dev-scoring-config'] })
      showToast('Weights saved successfully', 'success')
    },
    onError: () => {
      showToast('Failed to save weights. Please try again.', 'error')
    },
  })

  const total = weights
    ? Object.values(weights).reduce((s, v) => s + v, 0)
    : 0

  const handleSliderChange = (key: keyof ScoringWeights, value: number) => {
    if (!weights) return
    setWeights(redistribute(weights, key, value))
  }

  const handleSave = () => {
    if (!weights || total !== 100) return
    mutation.mutate(weights)
  }

  if (isLoading || !weights) {
    return (
      <div style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height="48px" width="100%" />
        ))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Global Default Weights
        </div>
        <p style={{ fontSize: '13px', marginTop: '4px', color: 'var(--text-muted)' }}>
          These weights apply to all new jobs that don't have custom weights set.
        </p>
        {config?.updated_at && (
          <p style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Last updated: {formatDateTime(config.updated_at)}
          </p>
        )}
      </div>

      {/* Warning banner */}
      <div
        className="badge badge-warning"
        style={{
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          fontSize: '12px',
          display: 'block',
          lineHeight: '1.6',
        }}
      >
        Changes here affect all new jobs without custom weights. Existing job weights are not changed.
      </div>

      {/* Sliders */}
      <div className="card" style={{ padding: '20px' }}>
        {WEIGHT_LABELS.map(({ key, label }) => (
          <div key={key} className="weight-row">
            <span className="weight-label">{label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={weights[key]}
              onChange={e => handleSliderChange(key, Number(e.target.value))}
              className="weight-slider"
            />
            <span className="weight-pct">{weights[key]}%</span>
          </div>
        ))}

        {/* Total */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '12px',
            marginTop: '4px',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Total</span>
          <span className={`weight-total ${total === 100 ? 'weight-total--valid' : 'weight-total--invalid'}`}>
            {total}%
          </span>
        </div>

        {total !== 100 && (
          <p style={{ fontSize: '11px', color: 'var(--color-danger)', marginTop: '6px' }}>
            Total must equal 100%. Currently: {total}%.
          </p>
        )}
      </div>

      {/* Save button */}
      <div>
        <button
          onClick={handleSave}
          disabled={total !== 100 || mutation.isPending}
          className="btn btn-primary"
        >
          {mutation.isPending ? 'Saving…' : 'Save Weights'}
        </button>
      </div>
    </div>
  )
}
