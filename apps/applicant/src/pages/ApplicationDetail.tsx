import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Clock } from 'lucide-react'
import { useApplication } from '../hooks/useApplications'
import { useJob } from '../hooks/useJobs'
import { ScoreRing, VerdictBadge } from '../components/Atoms'
import { Skeleton } from '../components/Skeleton'
import type { Verdict } from '@open-resource/shared'

const CATEGORY_LABELS: Record<string, string> = {
  technical_score: 'Technical Skills',
  experience_score: 'Experience',
  project_score: 'Projects',
  education_score: 'Education',
  communication_score: 'Communication',
}

const CATEGORY_KEYS = [
  'technical_score',
  'experience_score',
  'project_score',
  'education_score',
  'communication_score',
] as const

type CategoryKey = (typeof CATEGORY_KEYS)[number]

function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const config: Record<Verdict, { borderColor: string; message: string }> = {
    shortlisted: {
      borderColor: 'var(--color-success)',
      message: 'You have been shortlisted for this role',
    },
    reviewing: {
      borderColor: 'var(--color-warning)',
      message: 'Your application is under review',
    },
    rejected: {
      borderColor: 'var(--border-default)',
      message: 'You were not shortlisted for this role',
    },
  }

  const cfg = config[verdict]

  return (
    <div
      className="card"
      style={{ borderLeft: `3px solid ${cfg.borderColor}`, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}
    >
      <VerdictBadge verdict={verdict} />
      <span style={{ marginLeft: 10, color: 'var(--text-secondary)' }}>{cfg.message}</span>
    </div>
  )
}

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: application, isLoading, isError } = useApplication(id)
  const { data: job } = useJob(application?.job_id)

  // Use `scores` (the field the backend actually returns for applicants).
  const scores = application?.scores

  // Bug 1 fix: treat any post-close job status as "closed" for result visibility.
  // HR may advance the job to 'sourcing', 'interviewing', or 'hired' after scoring —
  // we must show results in those states too. `rank !== null` is the most reliable
  // signal that scoring has completed regardless of current job status.
  const isClosed =
    application?.rank !== null ||
    ['closed', 'sourcing', 'interviewing', 'hired'].includes(job?.status ?? '')

  const hasResults = isClosed && scores !== null && scores !== undefined

  if (isLoading) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Skeleton height="28px" width="50%" style={{ marginBottom: 12 }} />
        <Skeleton height="14px" width="35%" style={{ marginBottom: 20 }} />
        <div className="card">
          <Skeleton height="120px" />
        </div>
      </div>
    )
  }

  if (isError || !application) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Link
          to="/dashboard"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, textDecoration: 'none' }}
        >
          <ArrowLeft size={15} />
          My Applications
        </Link>
        <p style={{ color: 'var(--color-danger)' }}>Application not found.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Link
        to="/dashboard"
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, textDecoration: 'none' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
      >
        <ArrowLeft size={15} />
        My Applications
      </Link>

      {/* Job name header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">
          {application.job_title || job?.title || `Application #${application.id.slice(-6)}`}
        </h1>
        <p className="page-subtitle">
          Submitted{' '}
          {new Date(application.submitted_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Pending results state */}
      {!hasResults && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <Clock size={36} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Results pending
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            Results will be available after the application window closes.
          </p>
          <VerdictBadge verdict={application.status === 'pending' ? 'applied' : 'reviewing'} />
        </div>
      )}

      {/* Results revealed */}
      {hasResults && scores && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Hero: rank + score ring */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <ScoreRing score={scores.weighted_total} size={88} strokeWidth={8} showLabel />
              <div>
                {application.rank !== null && (
                  <div className="result-rank-display">
                    #{application.rank}
                  </div>
                )}
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Score: {scores.weighted_total} / 100
                </div>
              </div>
            </div>
          </div>

          {/* Verdict banner */}
          <VerdictBanner verdict={scores.verdict} />

          {/* Score breakdown */}
          <div className="card">
            <div className="panel-section-label" style={{ marginBottom: 14 }}>Score Breakdown</div>
            <div>
              {CATEGORY_KEYS.map((key: CategoryKey) => (
                <div key={key} className="score-breakdown-row">
                  <span className="sb-label">{CATEGORY_LABELS[key]}</span>
                  <div className="sb-bar-wrap">
                    <div
                      className="sb-bar"
                      style={{ width: `${scores[key]}%` }}
                    />
                  </div>
                  <span className="sb-score">{scores[key]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Feedback */}
          {scores.applicant_feedback && (
            <div className="card">
              <div className="panel-section-label" style={{ marginBottom: 10 }}>
                Feedback from the hiring team
              </div>
              <p className="reasoning-box">
                {scores.applicant_feedback}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
