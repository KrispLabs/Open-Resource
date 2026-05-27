import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MapPin,
  Briefcase,
  Calendar,
  Users,
  BarChart2,
  Github,
  Loader2,
  XCircle,
} from 'lucide-react'
import type { Job, Application } from '@open-resource/shared'
import { api } from '../api/client'
import { useToast } from '../components/Toast'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: 'var(--color-success)', bg: 'var(--color-success-dim)' },
  closed: { label: 'Closed', color: 'var(--color-warning)', bg: 'var(--color-warning-dim)' },
  draft: { label: 'Draft', color: 'var(--color-text-muted)', bg: 'rgba(92,99,112,0.15)' },
  archived: { label: 'Archived', color: 'var(--color-text-muted)', bg: 'rgba(92,99,112,0.15)' },
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [showCutoffPrompt, setShowCutoffPrompt] = useState(false)
  const [cutoff, setCutoff] = useState('')
  const [cutoffError, setCutoffError] = useState<string | null>(null)
  const [settingCutoff, setSettingCutoff] = useState(false)

  const { data: job, isLoading: jobLoading } = useQuery<Job>({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then((r) => r.data),
    enabled: !!id,
  })

  const { data: applications = [], isLoading: appsLoading } = useQuery<Application[]>({
    queryKey: ['applications', id],
    queryFn: () => api.get(`/jobs/${id}/applications`).then((r) => r.data),
    enabled: !!id,
  })

  const handleCloseApplications = async () => {
    setClosing(true)
    setCloseError(null)
    try {
      await api.post(`/jobs/${id}/close`)
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      setShowCutoffPrompt(true)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to close job'
      setCloseError(msg)
      showToast(msg, 'error')
    } finally {
      setClosing(false)
    }
  }

  const handleCutoffSubmit = async () => {
    const n = parseInt(cutoff, 10)
    if (isNaN(n) || n < 1) {
      setCutoffError('Enter a valid number (e.g. 10)')
      return
    }
    setSettingCutoff(true)
    setCutoffError(null)
    try {
      await api.patch(`/jobs/${id}`, { shortlist_cutoff: n })
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      navigate(`/jobs/${id}/scoring`)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to set cutoff'
      setCutoffError(msg)
    } finally {
      setSettingCutoff(false)
    }
  }

  const scoringDone =
    applications.length > 0 && applications.some((a) => a.candidate_scores !== null)

  if (jobLoading) {
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
        <Loader2 size={14} className="animate-spin" /> Loading job…
      </div>
    )
  }

  if (!job) {
    return (
      <div style={{ fontSize: '13px', color: 'var(--color-danger)' }}>
        Job not found.
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.draft

  return (
    <div style={{ maxWidth: '860px' }}>
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {job.title}
            </h1>
            <span
              style={{
                flexShrink: 0,
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
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              fontSize: '13px',
              color: 'var(--color-text-muted)',
            }}
          >
            {job.location && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={12} /> {job.location}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Briefcase size={12} /> {job.job_type}
            </span>
            {job.application_deadline && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Calendar size={12} /> Deadline: {new Date(job.application_deadline).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
          {job.status === 'active' && (
            <button
              onClick={handleCloseApplications}
              disabled={closing}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-warning)',
                border: 'none',
                cursor: closing ? 'not-allowed' : 'pointer',
                opacity: closing ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {closing && <Loader2 size={13} className="animate-spin" />}
              {closing ? 'Closing…' : 'Close Applications'}
            </button>
          )}
          {job.status === 'closed' && scoringDone && (
            <button
              onClick={() => navigate(`/jobs/${id}/rankings`)}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-primary)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-primary-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-primary)')}
            >
              <BarChart2 size={14} />
              View Rankings
            </button>
          )}
          {job.status === 'closed' && (
            <button
              onClick={() => navigate(`/jobs/${id}/outbound`)}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-elevated)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Github size={14} />
              Source from GitHub
            </button>
          )}
        </div>
      </div>

      {closeError && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            borderRadius: '6px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
            fontSize: '13px',
            color: 'var(--color-danger)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <XCircle size={14} /> {closeError}
        </div>
      )}

      {/* Shortlist cutoff prompt */}
      {showCutoffPrompt && (
        <div
          style={{
            marginBottom: '20px',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--color-primary)',
            backgroundColor: 'var(--color-primary-dim)',
          }}
        >
          <div
            style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '8px' }}
          >
            Set shortlist cutoff rank
          </div>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
            Candidates ranked at or above this number will be automatically shortlisted.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="number"
              min={1}
              placeholder="e.g. 10"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
              style={{
                width: '80px',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid var(--color-elevated)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleCutoffSubmit}
              disabled={settingCutoff}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-primary)',
                border: 'none',
                cursor: settingCutoff ? 'not-allowed' : 'pointer',
                opacity: settingCutoff ? 0.6 : 1,
              }}
            >
              {settingCutoff ? 'Saving…' : 'Start Scoring'}
            </button>
            <button
              onClick={() => navigate(`/jobs/${id}/scoring`)}
              style={{
                fontSize: '13px',
                color: 'var(--color-text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
          </div>
          {cutoffError && (
            <p style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-danger)' }}>
              {cutoffError}
            </p>
          )}
        </div>
      )}

      {/* Job description */}
      <div
        style={{
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid var(--color-elevated)',
          backgroundColor: 'var(--color-surface)',
          marginBottom: '20px',
        }}
      >
        <h2
          style={{
            fontSize: '13px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-muted)',
            marginBottom: '12px',
          }}
        >
          Job Description
        </h2>
        <div
          style={{
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
          }}
        >
          {job.description}
        </div>
      </div>

      {/* Applicants section */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
          }}
        >
          <Users size={14} style={{ color: 'var(--color-text-muted)' }} />
          <h2
            style={{
              fontSize: '13px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
            }}
          >
            Applications ({appsLoading ? '…' : applications.length})
          </h2>
        </div>

        {appsLoading ? (
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Loading…</div>
        ) : applications.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 24px',
              borderRadius: '8px',
              border: '1px dashed var(--color-elevated)',
              fontSize: '13px',
              color: 'var(--color-text-muted)',
            }}
          >
            No applications received yet. Share the job link.
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
                  {['Name', 'Status', 'Submitted'].map((h) => (
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
                {applications.map((app, i) => (
                  <tr
                    key={app.id}
                    style={{
                      borderBottom:
                        i < applications.length - 1 ? '1px solid var(--color-elevated)' : 'none',
                      backgroundColor: 'var(--color-surface)',
                    }}
                    onMouseEnter={e =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)')
                    }
                    onMouseLeave={e =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface)')
                    }
                  >
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {app.applicant_name}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color:
                            app.status === 'shortlisted'
                              ? 'var(--color-success)'
                              : app.status === 'rejected'
                              ? 'var(--color-danger)'
                              : app.status === 'reviewing'
                              ? 'var(--color-warning)'
                              : 'var(--color-text-muted)',
                          backgroundColor:
                            app.status === 'shortlisted'
                              ? 'var(--color-success-dim)'
                              : app.status === 'rejected'
                              ? 'var(--color-danger-dim)'
                              : app.status === 'reviewing'
                              ? 'var(--color-warning-dim)'
                              : 'rgba(92,99,112,0.15)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {app.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: '12px',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {new Date(app.submitted_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
