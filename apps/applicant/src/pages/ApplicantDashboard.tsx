import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMyApplications } from '../hooks/useApplications'
import { useAuthStore } from '../store/auth'
import { VerdictBadge } from '../components/Atoms'
import { SkeletonJobCards, EmptyState, EMPTY_STATES } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import type { ApplicantApplication } from '../api/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function ApplicantDashboard() {
  const { data: applications, isLoading, isError } = useMyApplications()
  const { user } = useAuthStore()
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    if (sessionStorage.getItem('or_apply_success')) {
      sessionStorage.removeItem('or_apply_success')
      showToast('Application submitted successfully!', 'success')
    }
  }, [showToast])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">My Applications</h1>
          {user && (
            <p className="page-subtitle">Welcome back, {user.name}</p>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && <SkeletonJobCards count={3} />}

      {/* Error */}
      {isError && (
        <div
          className="card"
          style={{ borderColor: 'var(--color-danger)', backgroundColor: 'var(--color-danger-dim)', color: 'var(--color-danger)' }}
        >
          Failed to load applications. Please refresh.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && applications?.length === 0 && (
        <div className="card">
          <EmptyState
            {...EMPTY_STATES.applications}
            action={{ label: 'Browse Jobs', onClick: () => navigate('/jobs') }}
          />
        </div>
      )}

      {/* Application list */}
      {!isLoading && !isError && applications && applications.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {applications.map((app: ApplicantApplication) => (
            <Link
              key={app.id}
              to={`/applications/${app.id}`}
              className="card card-clickable"
              style={{ display: 'block', textDecoration: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 2 }}>
                    {app.job_title || `Application #${app.id.slice(-6)}`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Submitted {formatDate(app.submitted_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <VerdictBadge verdict={app.status} />
                  {app.rank !== null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                      #{app.rank}
                    </span>
                  )}
                </div>
              </div>

              {app.scores && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Score:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {app.scores.weighted_total} / 100
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
