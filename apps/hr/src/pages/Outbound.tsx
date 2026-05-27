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

const PROGRESS_MESSAGES = [
  'Extracting search signals from job description...',
  'Searching GitHub for matching developers...',
  'Analyzing developer profiles...',
  'Writing personalized outreach emails...',
]

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

export default function Outbound() {
  const { id: jobId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [progressIdx, setProgressIdx] = useState(0)
  const { showToast } = useToast()
  const [sendError, setSendError] = useState<string | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch job info
  const { data: job } = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/jobs/${jobId}`).then((r) => r.data),
    enabled: !!jobId,
  })

  // Fetch existing campaign for this job
  const {
    data: campaign,
    isLoading: campaignLoading,
    refetch: refetchCampaign,
  } = useQuery<OutboundCampaign | null>({
    queryKey: ['campaign-for-job', jobId],
    queryFn: async () => {
      try {
        const res = await api.get<OutboundCampaign[]>(`/jobs/${jobId}/campaigns`)
        const campaigns: OutboundCampaign[] = res.data
        if (campaigns.length === 0) return null
        // Return the most recent campaign
        return campaigns.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]
      } catch {
        return null
      }
    },
    enabled: !!jobId,
  })

  // Fetch candidates once campaign is complete
  const { data: candidates = [], refetch: refetchCandidates } = useQuery<OutboundCandidate[]>({
    queryKey: ['campaign-candidates', campaign?.id],
    queryFn: () =>
      api.get<OutboundCandidate[]>(`/campaigns/${campaign!.id}/candidates`).then((r) => r.data),
    enabled: !!campaign && campaign.status === 'complete',
  })

  // Launch campaign mutation
  const { mutate: launchCampaign, isPending: launching, error: launchError } = useMutation({
    mutationFn: () => api.post<OutboundCampaign>(`/jobs/${jobId}/campaigns`).then((r) => r.data),
    onSuccess: (newCampaign) => {
      queryClient.setQueryData(['campaign-for-job', jobId], newCampaign)
    },
  })

  // Send all outreach mutation
  const { mutate: sendAll, isPending: sending } = useMutation({
    mutationFn: () =>
      api.post<{ sent: number }>(`/campaigns/${campaign!.id}/send-all`).then((r) => r.data),
    onSuccess: (data) => {
      showToast(`${data.sent} outreach email${data.sent !== 1 ? 's' : ''} sent.`, 'success')
      refetchCandidates()
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to send outreach.'
      setSendError(msg)
      showToast(msg, 'error')
    },
  })

  // Progress message cycling while campaign is running
  useEffect(() => {
    if (campaign?.status === 'running') {
      progressTimerRef.current = setInterval(() => {
        setProgressIdx((i) => (i + 1) % PROGRESS_MESSAGES.length)
      }, 3000)
    } else {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [campaign?.status])

  // Poll campaign status while running
  useEffect(() => {
    if (campaign?.status === 'running' && campaign.id) {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await api.get<OutboundCampaign>(`/campaigns/${campaign.id}`)
          queryClient.setQueryData(['campaign-for-job', jobId], res.data)
          if (res.data.status !== 'running') {
            if (pollingRef.current) clearInterval(pollingRef.current)
            if (res.data.status === 'complete') {
              queryClient.invalidateQueries({
                queryKey: ['campaign-candidates', res.data.id],
              })
            }
          }
        } catch {
          // silent — next poll will retry
        }
      }, 3000)
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [campaign?.status, campaign?.id, jobId, queryClient])

  const launchErrorMsg: string | null = launchError
    ? (() => {
        const detail = (launchError as { response?: { data?: { detail?: string } } })?.response
          ?.data?.detail
        return detail ?? 'Failed to launch campaign.'
      })()
    : null

  const isRateLimit =
    launchErrorMsg?.toLowerCase().includes('rate limit') ||
    sendError?.toLowerCase().includes('rate limit')

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

        {campaign && campaign.status === 'complete' && candidates.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
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
            action={{ label: launching ? 'Launching…' : 'Launch Campaign', onClick: () => !launching && launchCampaign() }}
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

      {/* Campaign error */}
      {campaign?.status === 'paused' && (
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
              queryClient.removeQueries({ queryKey: ['campaign-for-job', jobId] })
              refetchCampaign()
              launchCampaign()
            }}
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
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} /> Retry
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
    </div>
  )
}
