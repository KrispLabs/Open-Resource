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
  CheckCircle,
  Archive,
  RotateCcw,
  UserCheck,
} from 'lucide-react'
import type { Job, Application } from '@open-resource/shared'
import { api } from '../api/client'
import { useToast } from '../components/Toast'


function extractErrorMsg(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.length > 0) return detail
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; message?: string } | undefined
    return first?.msg ?? first?.message ?? fallback
  }
  if (detail && typeof detail === 'object') return fallback
  return fallback
}

function safeDateStr(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: 'var(--color-success)', bg: 'var(--color-success-dim)' },
  closed: { label: 'Closed', color: 'var(--color-warning)', bg: 'var(--color-warning-dim)' },
  draft: { label: 'Draft', color: 'var(--color-text-muted)', bg: 'rgba(92,99,112,0.15)' },
  sourcing: { label: 'Sourcing', color: 'var(--color-primary)', bg: 'var(--color-primary-dim)' },
  interviewing: { label: 'Interviewing', color: 'var(--color-warning)', bg: 'var(--color-warning-dim)' },
  hired: { label: 'Hired', color: 'var(--color-success)', bg: 'var(--color-success-dim)' },
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

  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [hiring, setHiring] = useState(false)
  const [showHireDialog, setShowHireDialog] = useState(false)
  const [hireCount, setHireCount] = useState('')
  const [hireNotes, setHireNotes] = useState('')
  const [hireError, setHireError] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)
  const [showReopenConfirm, setShowReopenConfirm] = useState(false)
  const [resetScoring, setResetScoring] = useState(false)
  const [movingToInterview, setMovingToInterview] = useState(false)

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
    console.group('[JobDetail] closeJob')
    console.log('job.status before close:', job?.status, '| id:', id)
    setClosing(true)
    setCloseError(null)
    try {
      const res = await api.post(`/jobs/${id}/close`, {})
      console.log('[JobDetail] close → success', res.data)
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      console.log('[JobDetail] invalidateQueries dispatched')
      setShowCutoffPrompt(true)
    } catch (err: unknown) {
      console.error('[JobDetail] close → error', err)
      const msg = extractErrorMsg(err, 'Failed to close job')
      setCloseError(msg)
      showToast(msg, 'error')
    } finally {
      setClosing(false)
      console.groupEnd()
    }
  }

  const handleCutoffSubmit = async () => {
    const n = parseInt(cutoff, 10)
    if (isNaN(n) || n < 1) {
      setCutoffError('Enter a valid number (e.g. 10)')
      return
    }
    console.group('[JobDetail] setCutoff + startScoring')
    console.log('cutoff:', n, '| job.status:', job?.status)
    setSettingCutoff(true)
    setCutoffError(null)
    try {
      const res = await api.patch(`/jobs/${id}`, { shortlist_cutoff: n })
      console.log('[JobDetail] patch shortlist_cutoff → success', res.data)
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      console.log('[JobDetail] navigating to scoring stream')
      navigate(`/jobs/${id}/scoring`)
    } catch (err: unknown) {
      console.error('[JobDetail] patch shortlist_cutoff → error', err)
      const msg = extractErrorMsg(err, 'Failed to set cutoff')
      setCutoffError(msg)
    } finally {
      setSettingCutoff(false)
      console.groupEnd()
    }
  }

  const handleArchive = async () => {
    setArchiving(true)
    try {
      await api.post(`/jobs/${id}/archive`, {})
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setShowArchiveConfirm(false)
      showToast('Job archived.', 'success')
    } catch (err: unknown) {
      showToast(extractErrorMsg(err, 'Failed to archive job'), 'error')
    } finally {
      setArchiving(false)
    }
  }

  const handleHire = async () => {
    const count = parseInt(hireCount, 10)
    if (isNaN(count) || count < 1) {
      setHireError('Enter a valid number')
      return
    }
    setHiring(true)
    setHireError(null)
    try {
      await api.post(`/jobs/${id}/hire`, { selected_count: count, notes: hireNotes })
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setShowHireDialog(false)
      showToast('Position marked as filled.', 'success')
    } catch (err: unknown) {
      const msg = extractErrorMsg(err, 'Failed to mark as hired')
      setHireError(msg)
      showToast(msg, 'error')
    } finally {
      setHiring(false)
    }
  }

  const handleReopen = async () => {
    setReopening(true)
    try {
      await api.post(`/jobs/${id}/reopen`, { reset_scoring: resetScoring })
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      if (resetScoring) queryClient.invalidateQueries({ queryKey: ['applications', id] })
      setShowReopenConfirm(false)
      showToast('Job reopened as draft.', 'success')
    } catch (err: unknown) {
      showToast(extractErrorMsg(err, 'Failed to reopen job'), 'error')
    } finally {
      setReopening(false)
    }
  }

  const handleMoveToInterviewing = async () => {
    setMovingToInterview(true)
    try {
      await api.post(`/jobs/${id}/interviewing`, {})
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      showToast('Job moved to interviewing stage.', 'success')
    } catch (err: unknown) {
      showToast(extractErrorMsg(err, 'Failed to update status'), 'error')
    } finally {
      setMovingToInterview(false)
    }
  }

  const safeApplications = Array.isArray(applications) ? applications : []
  const scoringDone =
    safeApplications.length > 0 && safeApplications.some((a) => a.candidate_scores !== null)

  console.log(
    '[JobDetail] render | status=%s scoring_done=%s apps=%d cutoff_prompt=%s',
    job?.status, scoringDone, safeApplications.length, showCutoffPrompt,
  )

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

  // Derived booleans for button visibility
  const canMoveToInterviewing = job.status === 'closed' || job.status === 'sourcing'
  const canMarkHired = ['closed', 'sourcing', 'interviewing'].includes(job.status)
  const canArchive = !['active', 'archived'].includes(job.status)
  const canReopen = job.status === 'archived' || job.status === 'hired'

  // Source from GitHub is accessible for closed/sourcing/interviewing
  const showSourceGitHub =
    job.status === 'closed' || job.status === 'sourcing' || job.status === 'interviewing'

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
                <Calendar size={12} /> Deadline: {safeDateStr(job.application_deadline)}
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
          {job.status !== 'draft' && job.status !== 'active' && job.status !== 'archived' && scoringDone && (
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
          {canMoveToInterviewing && (
            <button
              onClick={handleMoveToInterviewing}
              disabled={movingToInterview}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: movingToInterview ? 'not-allowed' : 'pointer',
                opacity: movingToInterview ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => {
                if (!movingToInterview) e.currentTarget.style.backgroundColor = 'var(--color-elevated)'
              }}
              onMouseLeave={e => {
                if (!movingToInterview) e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              {movingToInterview
                ? <Loader2 size={13} className="animate-spin" />
                : <UserCheck size={13} />
              }
              {movingToInterview ? 'Updating…' : 'Move to Interviewing'}
            </button>
          )}
          {canMarkHired && (
            <button
              onClick={() => setShowHireDialog(true)}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-success)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <CheckCircle size={13} />
              Mark as Hired
            </button>
          )}
          {showSourceGitHub && (
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
          {canArchive && (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-danger)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-danger)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-danger-dim)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Archive size={13} />
              Archive
            </button>
          )}
          {canReopen && (
            <button
              onClick={() => setShowReopenConfirm(true)}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-warning)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-warning)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-warning-dim)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <RotateCcw size={13} />
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Hired info banner */}
      {job.status === 'hired' && job.hiring_summary && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--color-success)',
            backgroundColor: 'var(--color-success-dim)',
          }}
        >
          <CheckCircle size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: 'var(--color-success)' }}>
            <span style={{ fontWeight: 600 }}>
              Position filled · {job.hiring_summary.selected_count} hired
            </span>
            <span style={{ marginLeft: '10px', opacity: 0.8 }}>
              {safeDateStr(job.hired_at)}
            </span>
            {job.hiring_summary.notes && (
              <span style={{ marginLeft: '10px', opacity: 0.8 }}>
                — {job.hiring_summary.notes}
              </span>
            )}
          </div>
        </div>
      )}

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

      {/* Archive confirm dialog */}
      {showArchiveConfirm && (
        <div
          style={{
            marginBottom: '20px',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
          }}
        >
          <div
            style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '6px' }}
          >
            Archive this job?
          </div>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
            The job will be hidden from your active list. All applications, rankings, and campaign history are preserved.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowArchiveConfirm(false)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleArchive}
              disabled={archiving}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-danger)',
                border: 'none',
                cursor: archiving ? 'not-allowed' : 'pointer',
                opacity: archiving ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {archiving && <Loader2 size={12} className="animate-spin" />}
              {archiving ? 'Archiving…' : 'Archive Job'}
            </button>
          </div>
        </div>
      )}

      {/* Hire dialog */}
      {showHireDialog && (
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
            style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '6px' }}
          >
            Mark Position as Filled
          </div>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
            Record how many candidates were selected.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  marginBottom: '4px',
                }}
              >
                Candidates hired
              </label>
              <input
                type="number"
                min={1}
                placeholder="e.g. 2"
                value={hireCount}
                onChange={(e) => setHireCount(e.target.value)}
                style={{
                  width: '100px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-elevated)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  marginBottom: '4px',
                }}
              >
                Notes (optional)
              </label>
              <textarea
                rows={2}
                placeholder="e.g. offered to 2 candidates"
                value={hireNotes}
                onChange={(e) => setHireNotes(e.target.value)}
                style={{
                  width: '100%',
                  maxWidth: '400px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-elevated)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
          {hireError && (
            <p style={{ marginBottom: '10px', fontSize: '12px', color: 'var(--color-danger)' }}>
              {hireError}
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setShowHireDialog(false); setHireError(null) }}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleHire}
              disabled={hiring}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-success)',
                border: 'none',
                cursor: hiring ? 'not-allowed' : 'pointer',
                opacity: hiring ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {hiring && <Loader2 size={12} className="animate-spin" />}
              {hiring ? 'Saving…' : 'Confirm Hire'}
            </button>
          </div>
        </div>
      )}

      {/* Reopen confirm dialog */}
      {showReopenConfirm && (
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
            style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '6px' }}
          >
            Reopen this job?
          </div>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
            The job will be moved back to Draft status and you can publish it again.
          </p>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              marginBottom: '12px',
            }}
          >
            <input
              type="checkbox"
              checked={resetScoring}
              onChange={(e) => setResetScoring(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Reset scoring data (removes all scores and rankings)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowReopenConfirm(false)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--color-elevated)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleReopen}
              disabled={reopening}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--color-primary)',
                border: 'none',
                cursor: reopening ? 'not-allowed' : 'pointer',
                opacity: reopening ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {reopening && <Loader2 size={12} className="animate-spin" />}
              {reopening ? 'Reopening…' : 'Reopen as Draft'}
            </button>
          </div>
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
            Applications ({appsLoading ? '…' : safeApplications.length})
          </h2>
        </div>

        {appsLoading ? (
          <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Loading…</div>
        ) : safeApplications.length === 0 ? (
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
                {safeApplications.map((app, i) => (
                  <tr
                    key={app.id}
                    style={{
                      borderBottom:
                        i < safeApplications.length - 1 ? '1px solid var(--color-elevated)' : 'none',
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
                      {safeDateStr(app.submitted_at)}
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
