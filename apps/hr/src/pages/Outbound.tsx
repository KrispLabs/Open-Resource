import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Github,
  Loader2,
  Send,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import type { OutboundCampaign, OutboundCandidate, Job } from '@open-resource/shared'
import { api } from '../api/client'
import { OutboundCandidateCard } from '../components/OutboundCandidateCard'
import { EmptyState, EMPTY_STATES } from '../components/Skeleton'
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

const PROGRESS_MESSAGES = [
  'Extracting search signals from job description...',
  'Searching GitHub for matching developers...',
  'Analyzing developer profiles...',
  'Writing personalized outreach emails...',
]

// Backend sets status="error" on unrecoverable failures; treat same as "paused" in UI
function isErrorStatus(status: string | undefined): boolean {
  return status === 'paused' || status === 'error'
}

function ProgressSpinner({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '64px 24px',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: '3px solid var(--color-elevated)',
          borderTopColor: 'var(--color-primary)',
          animation: 'spin 0.9s linear infinite',
        }}
      />
      <p
        style={{
          fontSize: '14px',
          color: 'var(--color-text-secondary)',
          textAlign: 'center',
          maxWidth: '320px',
        }}
      >
        {message}
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function StatsRow({
  totalFound,
  totalContacted,
  status,
}: {
  totalFound: number
  totalContacted: number
  status: string
}) {
  const statusColor =
    status === 'complete'
      ? 'var(--color-success)'
      : status === 'running'
      ? 'var(--color-primary)'
      : 'var(--color-danger)'
  const statusBg =
    status === 'complete'
      ? 'var(--color-success-dim)'
      : status === 'running'
      ? 'var(--color-primary-dim)'
      : 'var(--color-danger-dim)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        padding: '14px 20px',
        borderRadius: '8px',
        border: '1px solid var(--color-elevated)',
        backgroundColor: 'var(--color-surface)',
        marginBottom: '20px',
      }}
    >
      <div>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-muted)',
            marginBottom: '2px',
          }}
        >
          Developers Found
        </div>
        <div
          style={{
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {totalFound}
        </div>
      </div>
      <div style={{ width: 1, height: 32, backgroundColor: 'var(--color-elevated)' }} />
      <div>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-muted)',
            marginBottom: '2px',
          }}
        >
          Emails Ready
        </div>
        <div
          style={{
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {totalContacted > 0 ? totalContacted : totalFound}
        </div>
      </div>
      <div style={{ width: 1, height: 32, backgroundColor: 'var(--color-elevated)' }} />
      <span
        style={{
          padding: '3px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
          color: statusColor,
          backgroundColor: statusBg,
          textTransform: 'capitalize',
        }}
      >
        {status}
      </span>
    </div>
  )
}

// Use a type-cast helper to allow runtime status values not yet in shared CampaignStatus
function campaignStatusColor(status: OutboundCampaign['status'] | string): string {
  const s = status as string
  if (s === 'complete') return 'var(--color-success)'
  if (s === 'error' || s === 'paused') return 'var(--color-danger)'
  if (s === 'running') return 'var(--color-primary)'
  return 'var(--color-text-muted)'
}

function campaignStatusBg(status: OutboundCampaign['status'] | string): string {
  const s = status as string
  if (s === 'complete') return 'var(--color-success-dim)'
  if (s === 'error' || s === 'paused') return 'var(--color-danger-dim)'
  if (s === 'running') return 'var(--color-primary-dim)'
  return 'rgba(92,99,112,0.15)'
}

export default function Outbound() {
  const { id: jobId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [progressIdx, setProgressIdx] = useState(0)
  const { showToast } = useToast()
  const [sendError, setSendError] = useState<string | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch job info ────────────────────────────────────────────────────────
  const { data: job } = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/jobs/${jobId}`).then((r) => r.data),
    enabled: !!jobId,
  })

  // ── Fetch all campaigns for this job ─────────────────────────────────────
  // GET /api/jobs/{jobId}/campaigns — returns list[CampaignResponse], sorted newest-first
  const {
    data: allCampaigns = [],
    isLoading: campaignLoading,
  } = useQuery<OutboundCampaign[]>({
    queryKey: ['campaign-for-job', jobId],
    queryFn: async () => {
      const res = await api.get<OutboundCampaign[]>(`/api/jobs/${jobId}/campaigns`)
      const campaigns = Array.isArray(res.data) ? res.data : []
      console.log('[Outbound] fetched', campaigns.length, 'campaign(s)')
      return campaigns.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    },
    enabled: !!jobId,
    retry: false,
  })

  const campaign = allCampaigns[0] ?? null        // most recent
  const pastCampaigns = allCampaigns.slice(1)     // history

  // ── Fetch candidates once campaign is complete ────────────────────────────
  const { data: candidates = [], refetch: refetchCandidates } = useQuery<OutboundCandidate[]>({
    queryKey: ['campaign-candidates', campaign?.id],
    queryFn: () =>
      api.get<OutboundCandidate[]>(`/api/campaigns/${campaign!.id}/candidates`).then((r) => {
        console.log('[Outbound] candidates loaded:', r.data.length)
        return r.data
      }),
    enabled: !!campaign?.id && campaign.status === 'complete',
    retry: false,
  })

  // ── Launch campaign mutation ───────────────────────────────────────────────
  // POST returns CampaignCreateResponse { campaign_id, status } — not the full OutboundCampaign.
  // Invalidate the campaign-for-job query after success so a fresh GET fetches the full record.
  const { mutate: launchCampaign, isPending: launching, error: launchError } = useMutation({
    mutationFn: () =>
      api.post<{ campaign_id: string; status: string }>(`/api/jobs/${jobId}/campaigns`).then(
        (r) => r.data
      ),
    onSuccess: (data) => {
      console.log('[Outbound] campaign created →', data.campaign_id, 'status:', data.status)
      queryClient.invalidateQueries({ queryKey: ['campaign-for-job', jobId] })
    },
    onError: (err: unknown) => {
      console.error('[Outbound] campaign create failed:', err)
    },
  })

  // ── Send all outreach mutation ─────────────────────────────────────────────
  const { mutate: sendAll, isPending: sending } = useMutation({
    mutationFn: () =>
      api.post<{ sent: number }>(`/api/campaigns/${campaign!.id}/send-all`).then((r) => r.data),
    onSuccess: (data) => {
      console.log('[Outbound] send-all → sent:', data.sent)
      showToast(`${data.sent} outreach email${data.sent !== 1 ? 's' : ''} sent.`, 'success')
      refetchCandidates()
    },
    onError: (err: unknown) => {
      const msg = extractErrorMsg(err, 'Failed to send outreach.')
      console.error('[Outbound] send-all failed:', msg)
      setSendError(msg)
      showToast(msg, 'error')
    },
  })

  // ── Progress message cycling while campaign is running ────────────────────
  useEffect(() => {
    if (campaign?.status !== 'running') return
    // Reset to start of messages each time we enter running state
    setProgressIdx(0)
    const intervalId = setInterval(() => {
      setProgressIdx((i) => (i + 1) % PROGRESS_MESSAGES.length)
    }, 3000)
    progressTimerRef.current = intervalId
    console.log('[Outbound] progress timer started, campaign:', campaign?.id)
    return () => {
      clearInterval(intervalId)
      if (progressTimerRef.current === intervalId) progressTimerRef.current = null
    }
  }, [campaign?.status, campaign?.id])

  // ── Poll campaign status while running ────────────────────────────────────
  useEffect(() => {
    if (campaign?.status !== 'running' || !campaign?.id) return

    const campaignId = campaign.id  // capture immutable value for closure
    console.log('[Outbound] polling started for campaign:', campaignId)

    const intervalId = setInterval(async () => {
      try {
        const res = await api.get<OutboundCampaign>(`/api/campaigns/${campaignId}`)
        const updated = res.data
        console.log('[Outbound] poll →', campaignId, 'status:', updated.status)
        queryClient.setQueryData<OutboundCampaign[]>(['campaign-for-job', jobId], (prev) => {
          if (!prev) return [updated]
          return [updated, ...prev.slice(1)]
        })

        if (updated.status !== 'running') {
          clearInterval(intervalId)
          if (pollingRef.current === intervalId) pollingRef.current = null
          console.log('[Outbound] polling stopped — status:', updated.status)

          if (updated.status === 'complete') {
            queryClient.invalidateQueries({
              queryKey: ['campaign-candidates', campaignId],
            })
          }
        }
      } catch (err) {
        // Silent — next tick will retry. Log for visibility.
        console.warn('[Outbound] poll error (will retry):', err)
      }
    }, 3000)

    pollingRef.current = intervalId

    return () => {
      clearInterval(intervalId)
      if (pollingRef.current === intervalId) pollingRef.current = null
      console.log('[Outbound] polling cleanup for campaign:', campaignId)
    }
  }, [campaign?.status, campaign?.id, jobId, queryClient])

  const launchErrorMsg: string | null = launchError
    ? extractErrorMsg(launchError, 'Failed to launch campaign.')
    : null

  const isRateLimit =
    launchErrorMsg?.toLowerCase().includes('rate limit') ||
    sendError?.toLowerCase().includes('rate limit')

  // ── Initial load ──────────────────────────────────────────────────────────
  if (campaignLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--color-text-muted)',
        }}
      >
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '24px',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Github size={18} style={{ color: 'var(--color-text-secondary)' }} />
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
              }}
            >
              Source Candidates from GitHub
            </h1>
          </div>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--color-text-muted)',
              maxWidth: '580px',
              lineHeight: 1.5,
            }}
          >
            Claude analyzes the job description and searches GitHub for matching developers. Each
            profile is scored and a personalized outreach email is generated.
          </p>
          {job && (
            <div
              style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px' }}
            >
              Job:{' '}
              <Link
                to={`/jobs/${jobId}`}
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                {job.title}
              </Link>
            </div>
          )}
        </div>

        {campaign?.status === 'complete' && candidates.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
            {/* Relaunch button */}
            <button
              onClick={() => launchCampaign()}
              disabled={launching}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: launching ? 'not-allowed' : 'pointer',
                opacity: launching ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!launching)
                  e.currentTarget.style.backgroundColor = 'var(--color-elevated)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              {launching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {launching ? 'Launching…' : 'Relaunch Campaign'}
            </button>
            <Link
              to={`/campaigns/${campaign.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                textDecoration: 'none',
              }}
            >
              <ExternalLink size={13} />
              Full Tracker
            </Link>
            <button
              onClick={() => sendAll()}
              disabled={sending}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-primary)',
                border: 'none',
                cursor: sending ? 'not-allowed' : 'pointer',
                opacity: sending ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!sending) e.currentTarget.style.backgroundColor = 'var(--color-primary-hover)'
              }}
              onMouseLeave={(e) => {
                if (!sending) e.currentTarget.style.backgroundColor = 'var(--color-primary)'
              }}
            >
              {sending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
              {sending ? 'Sending…' : 'Send All Outreach'}
            </button>
          </div>
        )}
      </div>

      {/* Error: rate limit */}
      {isRateLimit && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--color-warning)',
            backgroundColor: 'var(--color-warning-dim)',
            fontSize: '13px',
            color: 'var(--color-warning)',
            marginBottom: '16px',
          }}
        >
          <AlertTriangle size={14} />
          GitHub API rate limit reached. Please wait 60 seconds before launching again.
        </div>
      )}

      {/* Generic launch error */}
      {launchErrorMsg && !isRateLimit && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
            fontSize: '13px',
            color: 'var(--color-danger)',
            marginBottom: '16px',
          }}
        >
          <AlertTriangle size={14} />
          {launchErrorMsg}
        </div>
      )}

      {/* Send error */}
      {sendError && !isRateLimit && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
            fontSize: '13px',
            color: 'var(--color-danger)',
            marginBottom: '16px',
          }}
        >
          <AlertTriangle size={14} />
          {sendError}
        </div>
      )}

      {/* No campaign yet */}
      {!campaign && (
        <div style={{ border: '1px dashed var(--border-default)', borderRadius: '8px' }}>
          <EmptyState
            {...EMPTY_STATES.campaign}
            action={{
              label: launching ? 'Launching…' : 'Launch Campaign',
              onClick: () => !launching && launchCampaign(),
            }}
          />
        </div>
      )}

      {/* Campaign running */}
      {campaign?.status === 'running' && (
        <div
          style={{
            borderRadius: '8px',
            border: '1px solid var(--color-elevated)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <ProgressSpinner message={PROGRESS_MESSAGES[progressIdx]} />
        </div>
      )}

      {/* Campaign error (backend uses "paused" or "error") */}
      {campaign && isErrorStatus(campaign.status) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderRadius: '8px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              color: 'var(--color-danger)',
            }}
          >
            <AlertTriangle size={14} />
            Campaign encountered an error. Please try again.
          </div>
          <button
            onClick={() => {
              console.log('[Outbound] retry — invalidating and relaunching')
              queryClient.invalidateQueries({ queryKey: ['campaign-for-job', jobId] })
              launchCampaign()
            }}
            disabled={launching}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--color-danger)',
              border: '1px solid var(--color-danger)',
              backgroundColor: 'transparent',
              cursor: launching ? 'not-allowed' : 'pointer',
              opacity: launching ? 0.6 : 1,
            }}
          >
            <RefreshCw size={12} />
            {launching ? 'Launching…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Campaign complete */}
      {campaign?.status === 'complete' && (
        <>
          <StatsRow
            totalFound={campaign.total_found}
            totalContacted={campaign.total_contacted}
            status={campaign.status}
          />

          {candidates.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '64px 24px',
                borderRadius: '8px',
                border: '1px dashed var(--color-elevated)',
              }}
            >
              <Github
                size={36}
                style={{ color: 'var(--color-text-muted)', marginBottom: '12px' }}
              />
              <p
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  marginBottom: '4px',
                }}
              >
                No matching developers found on GitHub for this role.
              </p>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--color-text-muted)',
                  textAlign: 'center',
                  maxWidth: '400px',
                }}
              >
                Try adjusting the job description for more specific technology requirements.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
                gap: '16px',
              }}
            >
              {candidates.map((c) => (
                <OutboundCandidateCard key={c.id} candidate={c} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Campaign history */}
      {pastCampaigns.length > 0 && (
        <div style={{ marginTop: '36px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
              marginBottom: '12px',
            }}
          >
            Previous Campaigns ({pastCampaigns.length})
          </div>
          <div
            style={{
              borderRadius: '8px',
              border: '1px solid var(--color-elevated)',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderBottom: '1px solid var(--color-elevated)',
                  }}
                >
                  {['Run', 'Date', 'Status', 'Developers Found', 'Emails Sent'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 16px',
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pastCampaigns.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom:
                        i < pastCampaigns.length - 1 ? '1px solid var(--color-elevated)' : 'none',
                      backgroundColor: 'var(--color-surface)',
                    }}
                    onMouseEnter={e =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-elevated)')
                    }
                    onMouseLeave={e =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface)')
                    }
                  >
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      #{c.run_number && c.run_number > 0 ? c.run_number : i + 2}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '13px',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: campaignStatusColor(c.status),
                          backgroundColor: campaignStatusBg(c.status),
                          textTransform: 'capitalize',
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '13px',
                        color: 'var(--color-text-secondary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {c.total_found}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '13px',
                        color: 'var(--color-text-secondary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {c.total_contacted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
