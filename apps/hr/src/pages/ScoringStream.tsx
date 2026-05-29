import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useSSE } from '../hooks/useSSE'
import { api } from '../api/client'
import { CheckCircle, Loader2, XCircle, User, ArrowLeft } from 'lucide-react'
import { useToast } from '../components/Toast'

interface CandidateCard {
  name: string
  index: number
  score?: number
  verdict?: string
  done: boolean
  error?: string
}

interface SessionDoneSummary {
  shortlisted: number
  not_shortlisted: number
  reviewing: number
}

export default function ScoringStream() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  // 'starting' = calling POST /score, 'streaming' = SSE active, 'error' = failed
  const [initState, setInitState] = useState<'starting' | 'streaming' | 'error'>('starting')
  const [initError, setInitError] = useState<string | null>(null)
  const [jobNotClosed, setJobNotClosed] = useState(false)

  // Only connect SSE once POST /score succeeds
  const ssePath = initState === 'streaming' && id ? `/jobs/${id}/stream` : null
  const { events, status, error: sseError } = useSSE(ssePath)

  useEffect(() => {
    if (!id) return

    // AbortController cancels the in-flight POST when Strict Mode unmounts the first
    // instance, preventing the double-fire that would otherwise occur in development.
    const ctrl = new AbortController()
    let cancelled = false

    async function triggerScoring() {
      // Wait 500ms before calling POST /score. The backend's POST /close
      // auto-starts a scoring background task; this gap lets that task register
      // first so both don't race each other. The backend deduplicates concurrent
      // scoring sessions by job, so even if both fire the user-visible effect is
      // a single stream — but the delay prevents an unnecessary second task from
      // being created at all.
      await new Promise<void>((resolve) => {
        const tid = setTimeout(resolve, 500)
        ctrl.signal.addEventListener('abort', () => { clearTimeout(tid); resolve() })
      })
      if (cancelled || ctrl.signal.aborted) return

      try {
        await api.post(`/jobs/${id}/score`, undefined, { signal: ctrl.signal })
        if (!cancelled) setInitState('streaming')
      } catch (err: unknown) {
        if (ctrl.signal.aborted || cancelled) return
        const httpStatus = (err as { response?: { status?: number } })?.response?.status
        if (httpStatus === 400) {
          setJobNotClosed(true)
        }
        const errMsg = httpStatus === 400
          ? 'Job must be closed before scoring. Go back and close the job first.'
          : ((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to start scoring.')
        setInitError(errMsg)
        showToast(errMsg, 'error')
        setInitState('error')
      }
    }

    triggerScoring()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [id])

  // Build candidate cards from events
  const cardMap = new Map<number, CandidateCard>()
  let sessionDone: SessionDoneSummary | null = null

  for (const ev of events) {
    if (ev.type === 'candidate_start') {
      const p = ev.payload as { name: string; index: number }
      cardMap.set(p.index, { name: p.name, index: p.index, done: false })
    }
    if (ev.type === 'candidate_done') {
      const p = ev.payload as { name: string; index: number; score: number; verdict: string; error?: string }
      const existing = cardMap.get(p.index) ?? { name: p.name, index: p.index, done: false }
      cardMap.set(p.index, { ...existing, score: p.score, verdict: p.verdict, done: true, error: p.error })
    }
    if (ev.type === 'session_done') {
      sessionDone = ev.payload as unknown as SessionDoneSummary
    }
  }

  const candidates = Array.from(cardMap.values()).sort((a, b) => a.index - b.index)
  const steps = events.filter(e => e.type === 'step').map(e => (e.payload as { text: string }).text)

  const verdictColor = (v?: string): string =>
    v === 'shortlisted' ? 'var(--color-success)' :
    v === 'rejected' ? 'var(--color-danger)' :
    'var(--color-warning)'

  const streamingLabel =
    status === 'streaming' ? 'Processing candidates…' :
    status === 'done' ? 'Scoring complete.' :
    status === 'error' ? 'Connection error.' :
    'Connecting to stream…'

  // Starting state — calling POST /score
  if (initState === 'starting') {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>AI Scoring</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Starting scoring…</p>
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          Initializing scoring session…
        </div>
      </div>
    )
  }

  // Error state — could not start scoring
  if (initState === 'error') {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>AI Scoring</h1>
        </div>
        <div
          className="p-4 rounded-lg border text-sm"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-danger)',
            color: 'var(--color-danger)',
          }}
        >
          <div className="flex items-start gap-2">
            <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{initError}</span>
          </div>
        </div>
        <button
          onClick={() => navigate(jobNotClosed ? `/jobs/${id}` : -1 as unknown as string)}
          className="mt-4 flex items-center gap-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <ArrowLeft size={14} />
          {jobNotClosed ? 'Go to Job' : 'Go Back'}
        </button>
      </div>
    )
  }

  // Streaming state
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>AI Scoring</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{streamingLabel}</p>
      </div>

      {/* Step log */}
      {steps.length > 0 && (
        <div className="mb-4 space-y-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <CheckCircle size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              {s}
            </div>
          ))}
        </div>
      )}

      {/* Candidate cards */}
      <div className="space-y-2">
        {candidates.map(c => (
          <div
            key={c.index}
            className="flex items-center justify-between p-3 rounded-lg border"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-elevated)' }}
          >
            <div className="flex items-center gap-3">
              <User size={15} style={{ color: 'var(--color-text-muted)' }} />
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{c.name}</div>
                {c.error && <div className="text-xs" style={{ color: 'var(--color-danger)' }}>Scoring failed</div>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {c.done ? (
                <>
                  {c.score !== undefined && (
                    <span
                      className="text-sm font-bold"
                      style={{ color: 'var(--color-text-primary)', fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {c.score.toFixed(1)}
                    </span>
                  )}
                  {c.verdict && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded"
                      style={{
                        color: verdictColor(c.verdict),
                        backgroundColor: `${verdictColor(c.verdict)}22`,
                        borderRadius: '4px',
                      }}
                    >
                      {c.verdict}
                    </span>
                  )}
                  <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />
                </>
              ) : (
                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Session done summary */}
      {sessionDone && (
        <div
          className="mt-6 p-4 rounded-lg border"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-elevated)' }}
        >
          <div className="flex items-center gap-4 text-sm">
            <span style={{ color: 'var(--color-success)' }}>✓ {sessionDone.shortlisted} shortlisted</span>
            <span style={{ color: 'var(--color-warning)' }}>· {sessionDone.reviewing} reviewing</span>
            <span style={{ color: 'var(--color-danger)' }}>· {sessionDone.not_shortlisted} rejected</span>
          </div>
          <button
            onClick={() => {
              // Ensure Rankings page never renders pre-scoring stale data.
              // staleTime=30s + refetchOnWindowFocus=false means cache won't
              // self-heal within the typical scoring session window.
              queryClient.invalidateQueries({ queryKey: ['applications', id] })
              navigate(`/jobs/${id}/rankings`)
            }}
            className="mt-3 px-4 py-2 rounded text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--color-primary)', borderRadius: '6px' }}
          >
            View Full Rankings →
          </button>
        </div>
      )}

      {sseError && (
        <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <XCircle size={14} /> {sseError}
        </div>
      )}
    </div>
  )
}
