import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Send,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { OutboundCampaign, OutboundCandidate, OutreachStatus, Job } from '@open-resource/shared'
import { api } from '../api/client'
import { useToast } from '../components/Toast'

const STATUS_TABS: Array<{ key: OutreachStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'opened', label: 'Opened' },
  { key: 'replied', label: 'Replied' },
]

function outreachStatusConfig(status: OutreachStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', color: 'var(--color-primary)', bg: 'var(--color-primary-dim)' }
    case 'sent':
      return { label: 'Sent', color: 'var(--color-success)', bg: 'var(--color-success-dim)' }
    case 'opened':
      return { label: 'Opened', color: 'var(--color-warning)', bg: 'var(--color-warning-dim)' }
    case 'replied':
      return { label: 'Replied', color: 'var(--color-success)', bg: 'var(--color-success-dim)' }
    default:
      return { label: status, color: 'var(--color-text-muted)', bg: 'rgba(92,99,112,0.15)' }
  }
}

function campaignStatusConfig(status: string): { color: string; bg: string } {
  switch (status) {
    case 'complete':
      return { color: 'var(--color-success)', bg: 'var(--color-success-dim)' }
    case 'running':
      return { color: 'var(--color-primary)', bg: 'var(--color-primary-dim)' }
    default:
      return { color: 'var(--color-danger)', bg: 'var(--color-danger-dim)' }
  }
}

interface ExpandedEmailRowProps {
  email: string
}

function ExpandedEmailRow({ email }: ExpandedEmailRowProps) {
  return (
    <tr>
      <td
        colSpan={5}
        style={{
          padding: '0 16px 12px 72px',
          backgroundColor: 'var(--color-bg)',
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: '10px 14px',
            borderRadius: '6px',
            border: '1px solid var(--color-elevated)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {email}
        </pre>
      </td>
    </tr>
  )
}

export default function Campaign() {
  const { id: campaignId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = useState<OutreachStatus | 'all'>('all')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [confirmSendAll, setConfirmSendAll] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const {
    data: campaign,
    isLoading: campaignLoading,
    error: campaignError,
  } = useQuery<OutboundCampaign>({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<OutboundCampaign>(`/campaigns/${campaignId}`).then((r) => r.data),
    enabled: !!campaignId,
  })

  const {
    data: candidates = [],
    isLoading: candidatesLoading,
    error: candidatesError,
  } = useQuery<OutboundCandidate[]>({
    queryKey: ['campaign-candidates', campaignId],
    queryFn: () =>
      api.get<OutboundCandidate[]>(`/campaigns/${campaignId}/candidates`).then((r) => r.data),
    enabled: !!campaignId,
  })

  // Fetch job for title
  const { data: job } = useQuery<Job>({
    queryKey: ['job', campaign?.job_id],
    queryFn: () => api.get<Job>(`/jobs/${campaign!.job_id}`).then((r) => r.data),
    enabled: !!campaign?.job_id,
  })

  const { mutate: sendAll, isPending: sending } = useMutation({
    mutationFn: () =>
      api.post<{ sent: number }>(`/campaigns/${campaignId}/send-all`).then((r) => r.data),
    onSuccess: (data) => {
      setConfirmSendAll(false)
      showToast(`${data.sent} outreach email${data.sent !== 1 ? 's' : ''} sent.`, 'success')
      queryClient.invalidateQueries({ queryKey: ['campaign-candidates', campaignId] })
    },
    onError: (err: unknown) => {
      setConfirmSendAll(false)
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to send outreach.'
      setSendError(msg)
      showToast(msg, 'error')
    },
  })

  const filteredCandidates =
    activeTab === 'all'
      ? candidates
      : candidates.filter((c) => c.outreach_status === activeTab)

  const allSent = candidates.length > 0 && candidates.every((c) => c.outreach_status !== 'draft')
  const draftCount = candidates.filter((c) => c.outreach_status === 'draft').length

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
        <Loader2 size={14} className="animate-spin" /> Loading campaign…
      </div>
    )
  }

  if (campaignError || !campaign) {
    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: '8px',
          border: '1px solid var(--color-danger)',
          backgroundColor: 'var(--color-danger-dim)',
          fontSize: '13px',
          color: 'var(--color-danger)',
        }}
      >
        Failed to load campaign.
      </div>
    )
  }

  const campaignStatusCfg = campaignStatusConfig(campaign.status)

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
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: '4px',
            }}
          >
            GitHub Sourcing Campaign
            {job && (
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                {' '}— {job.title}
              </span>
            )}
          </h1>

          {/* Stats row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              fontSize: '13px',
              color: 'var(--color-text-muted)',
              flexWrap: 'wrap',
            }}
          >
            <span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {campaign.total_found}
              </span>{' '}
              found
            </span>
            <span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {campaign.total_contacted}
              </span>{' '}
              sent
            </span>
            <span
              style={{
                padding: '2px 9px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                color: campaignStatusCfg.color,
                backgroundColor: campaignStatusCfg.bg,
                textTransform: 'capitalize',
              }}
            >
              {campaign.status}
            </span>
            <span>{new Date(campaign.created_at).toLocaleDateString()}</span>
            {job && (
              <Link
                to={`/jobs/${campaign.job_id}/outbound`}
                style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: '12px' }}
              >
                ← Back to Outbound
              </Link>
            )}
          </div>
        </div>

        {/* Send All button */}
        <button
          onClick={() => setConfirmSendAll(true)}
          disabled={allSent || sending}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            color: '#fff',
            backgroundColor: allSent ? 'var(--color-text-muted)' : 'var(--color-primary)',
            border: 'none',
            cursor: allSent ? 'not-allowed' : 'pointer',
            opacity: allSent || sending ? 0.6 : 1,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (!allSent && !sending)
              e.currentTarget.style.backgroundColor = 'var(--color-primary-hover)'
          }}
          onMouseLeave={(e) => {
            if (!allSent && !sending)
              e.currentTarget.style.backgroundColor = 'var(--color-primary)'
          }}
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {sending ? 'Sending…' : allSent ? 'All Sent' : 'Send All Outreach'}
        </button>
      </div>

      {/* Send all confirmation */}
      {confirmSendAll && (
        <div
          style={{
            marginBottom: '16px',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--color-primary)',
            backgroundColor: 'var(--color-primary-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>
            Send outreach emails to <strong>{draftCount}</strong> candidate{draftCount !== 1 ? 's' : ''}?
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => sendAll()}
              disabled={sending}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-primary)',
                border: 'none',
                cursor: sending ? 'not-allowed' : 'pointer',
                opacity: sending ? 0.6 : 1,
              }}
            >
              {sending ? 'Sending…' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmSendAll(false)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Send error */}
      {sendError && (
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

      {/* Status filter tabs */}
      <div
        style={{
          display: 'flex',
          gap: '2px',
          marginBottom: '16px',
          backgroundColor: 'var(--color-surface)',
          padding: '3px',
          borderRadius: '8px',
          border: '1px solid var(--color-elevated)',
          width: 'fit-content',
        }}
      >
        {STATUS_TABS.map(({ key, label }) => {
          const count =
            key === 'all' ? candidates.length : candidates.filter((c) => c.outreach_status === key).length
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isActive ? 'var(--color-elevated)' : 'transparent',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                transition: 'background-color 100ms',
              }}
            >
              {label}
              <span
                style={{
                  marginLeft: '5px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: isActive ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      {candidatesLoading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--color-text-muted)',
            padding: '32px',
          }}
        >
          <Loader2 size={14} className="animate-spin" /> Loading candidates…
        </div>
      ) : candidatesError ? (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '8px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
            fontSize: '13px',
            color: 'var(--color-danger)',
          }}
        >
          Failed to load candidates. Please refresh.
        </div>
      ) : filteredCandidates.length === 0 ? (
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
          <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            No candidates
          </p>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {activeTab === 'all'
              ? 'No candidates have been sourced yet.'
              : `No candidates with status "${activeTab}".`}
          </p>
        </div>
      ) : (
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
                {['Candidate', 'Score', 'Status', 'Sent At', 'Actions'].map((h) => (
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
              {filteredCandidates.map((candidate, i) => {
                const statusCfg = outreachStatusConfig(candidate.outreach_status)
                const isExpanded = expandedRow === candidate.id
                const isLast = i === filteredCandidates.length - 1

                return (
                  <>
                    <tr
                      key={candidate.id}
                      style={{
                        borderBottom:
                          !isExpanded && !isLast ? '1px solid var(--color-elevated)' : isExpanded ? '1px solid var(--color-elevated)' : 'none',
                        backgroundColor: isExpanded
                          ? 'var(--color-primary-dim)'
                          : 'var(--color-surface)',
                        transition: 'background-color 120ms',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded)
                          e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded)
                          e.currentTarget.style.backgroundColor = 'var(--color-surface)'
                      }}
                    >
                      {/* Avatar + username */}
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <img
                            src={`https://avatars.githubusercontent.com/${candidate.github_username}`}
                            alt={candidate.github_username}
                            width={32}
                            height={32}
                            style={{
                              borderRadius: '50%',
                              border: '1px solid var(--color-elevated)',
                              flexShrink: 0,
                            }}
                          />
                          <div>
                            {candidate.name && (
                              <div
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: 'var(--color-text-primary)',
                                }}
                              >
                                {candidate.name}
                              </div>
                            )}
                            <a
                              href={candidate.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: '12px',
                                color: 'var(--color-primary)',
                                textDecoration: 'none',
                              }}
                            >
                              @{candidate.github_username}
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* Score */}
                      <td style={{ padding: '10px 16px', width: '80px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '14px',
                            fontWeight: 600,
                            color:
                              candidate.profile_score >= 75
                                ? 'var(--color-success)'
                                : candidate.profile_score >= 55
                                ? 'var(--color-primary)'
                                : candidate.profile_score >= 40
                                ? 'var(--color-warning)'
                                : 'var(--color-danger)',
                          }}
                        >
                          {candidate.profile_score}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '10px 16px', width: '110px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: statusCfg.color,
                            backgroundColor: statusCfg.bg,
                          }}
                        >
                          {statusCfg.label}
                        </span>
                      </td>

                      {/* Sent at */}
                      <td
                        style={{
                          padding: '10px 16px',
                          fontSize: '12px',
                          color: 'var(--color-text-muted)',
                          width: '120px',
                        }}
                      >
                        {candidate.sent_at
                          ? new Date(candidate.sent_at).toLocaleDateString()
                          : '—'}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '10px 16px', width: '120px' }}>
                        <button
                          onClick={() =>
                            setExpandedRow(isExpanded ? null : candidate.id)
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: isExpanded
                              ? 'var(--color-primary)'
                              : 'var(--color-text-secondary)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0',
                          }}
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={13} /> Hide Email
                            </>
                          ) : (
                            <>
                              <ChevronDown size={13} /> View Email
                            </>
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded email row */}
                    {isExpanded && (
                      <tr
                        key={`${candidate.id}-email`}
                        style={{
                          borderBottom:
                            i < filteredCandidates.length - 1
                              ? '1px solid var(--color-elevated)'
                              : 'none',
                          backgroundColor: 'var(--color-bg)',
                        }}
                      >
                        <ExpandedEmailRow email={candidate.outreach_email} />
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
