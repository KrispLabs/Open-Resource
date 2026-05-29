import { useEffect } from 'react'
import type { Application, Verdict } from '@open-resource/shared'
import { ScoreRing } from './Atoms'
import { VerdictBadge } from './Atoms'
import { api } from '../api/client'
import { useState } from 'react'

interface CandidatePanelProps {
  application: Application | null
  totalCandidates?: number
  onClose: () => void
  onVerdictChange?: (id: string, status: Application['status'], verdict: Verdict) => void
}

function DimBar({ score }: { score: number }) {
  const cls =
    score >= 75 ? 'dim-bar--high' :
    score >= 55 ? 'dim-bar--mid'  :
    score >= 40 ? 'dim-bar--low'  : 'dim-bar--danger'
  return (
    <div className="dim-bar-wrap">
      <div className={`dim-bar ${cls}`} style={{ width: `${score}%` }} />
    </div>
  )
}

export function CandidatePanel({
  application,
  totalCandidates,
  onClose,
  onVerdictChange,
}: CandidatePanelProps) {
  const open = application !== null
  const [actionLoading, setActionLoading] = useState<'shortlist' | 'reject' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Reset error when application changes
  useEffect(() => {
    setActionError(null)
  }, [application?.id])

  const s = application?.candidate_scores

  const dimensions = s ? [
    { label: 'Technical Skills', score: s.technical_score },
    { label: 'Experience',       score: s.experience_score },
    { label: 'Projects',         score: s.project_score },
    { label: 'Education',        score: s.education_score },
    { label: 'Communication',    score: s.communication_score },
  ] : []

  const handleAction = async (action: 'shortlist' | 'reject') => {
    if (!application) return
    setActionLoading(action)
    setActionError(null)

    const status: Application['status'] = action === 'shortlist' ? 'shortlisted' : 'rejected'
    const verdict: Verdict = action === 'shortlist' ? 'shortlisted' : 'rejected'

    try {
      await api.patch(`/applications/${application.id}`, { status, verdict })
      onVerdictChange?.(application.id, status, verdict)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Failed to update candidate'
      setActionError(msg)
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`panel-backdrop ${open ? 'open' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={`candidate-panel ${open ? 'open' : ''}`}
        aria-label="Candidate detail"
        role="complementary"
      >
        {application && (
          <>
            {/* HEAD */}
            <div className="panel-head">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="panel-name">{application.applicant_name}</div>
                  <div className="panel-meta">Rank #{application.rank ?? '—'}</div>
                </div>
                <button
                  onClick={onClose}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '16px', padding: '2px 6px', borderRadius: '4px', lineHeight: 1 }}
                  aria-label="Close panel"
                >✕</button>
              </div>

              {s && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
                  <ScoreRing score={Math.round(s.weighted_total)} size={48} strokeWidth={4} showLabel />
                  <VerdictBadge verdict={application.status} />
                  {application.rank && totalCandidates && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Rank #{application.rank} of {totalCandidates}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* BODY */}
            <div className="panel-body">
              {s ? (
                <>
                  {/* Reasoning */}
                  <div className="panel-section">
                    <div className="panel-section-label">Why this candidate?</div>
                    <div className="reasoning-box">{s.reasoning}</div>
                  </div>

                  {/* Dimension scores */}
                  <div className="panel-section">
                    <div className="panel-section-label">Dimension scores</div>
                    {dimensions.map(d => (
                      <div className="dim-row" key={d.label}>
                        <span className="dim-label">{d.label}</span>
                        <DimBar score={d.score} />
                        <span className="dim-score">{Math.round(d.score)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Skills */}
                  {(s.matched_skills.length > 0 || s.missing_skills.length > 0) && (
                    <div className="panel-section">
                      <div className="panel-section-label">Skills</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Matched</div>
                          <div className="skill-tags" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                            {s.matched_skills.map(sk => (
                              <span key={sk} className="skill-tag skill-tag--matched">{sk}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Missing</div>
                          <div className="skill-tags" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                            {s.missing_skills.map(sk => (
                              <span key={sk} className="skill-tag skill-tag--missing">– {sk}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Strengths & Gaps */}
                  {(s.strengths.length > 0 || s.gaps.length > 0) && (
                    <div className="panel-section">
                      <div className="panel-section-label">Strengths &amp; gaps</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {s.strengths.map(str => (
                            <span key={str} className="badge badge-success" style={{ justifyContent: 'flex-start' }}>{str}</span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {s.gaps.map(g => (
                            <span key={g} className="badge badge-warning" style={{ justifyContent: 'flex-start' }}>{g}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Interview questions */}
                  {s.interview_questions.length > 0 && (
                    <div className="panel-section">
                      <div className="panel-section-label">Interview questions</div>
                      {s.interview_questions.map((q, i) => (
                        <div className="iq-item" key={i}>
                          <span className="iq-num">Q{i + 1}</span>
                          <span>{q}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Applicant feedback */}
                  <div className="panel-section">
                    <div className="panel-section-label">Applicant feedback preview</div>
                    <div className="internal-note">{s.applicant_feedback}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Visible to applicant after results release
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  Scoring not yet complete for this candidate.
                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="panel-footer">
              {onVerdictChange && (
                <>
                  <button
                    className="btn btn-success btn-sm"
                    style={{ flex: 1 }}
                    disabled={actionLoading !== null}
                    onClick={() => handleAction('shortlist')}
                  >
                    {actionLoading === 'shortlist' ? 'Saving…' : 'Shortlist'}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={actionLoading !== null}
                    onClick={() => handleAction('reject')}
                  >
                    {actionLoading === 'reject' ? 'Saving…' : 'Reject'}
                  </button>
                </>
              )}
              {actionError && (
                <span style={{ fontSize: '11px', color: 'var(--color-danger)', flex: 1 }}>{actionError}</span>
              )}
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
