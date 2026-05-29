import { Link, useNavigate, useParams } from 'react-router-dom'
import { MapPin, Calendar, ArrowLeft } from 'lucide-react'
import { useJob } from '../hooks/useJobs'
import { useMyApplications } from '../hooks/useApplications'
import { useAuthStore } from '../store/auth'
import { VerdictBadge } from '../components/Atoms'
import { Skeleton } from '../components/Skeleton'

function DeadlineText({ deadline, status }: { deadline: string | null; status: string }) {
  if (status !== 'active') {
    return <span style={{ color: 'var(--text-muted)' }}>Closed</span>
  }

  if (!deadline) {
    return <span style={{ color: 'var(--color-success)' }}>Open</span>
  }

  const daysLeft = Math.ceil(
    (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  let color = 'var(--color-success)'
  if (daysLeft <= 0) color = 'var(--color-danger)'
  else if (daysLeft <= 7) color = 'var(--color-warning)'

  const formatted = new Date(deadline).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <span style={{ color }}>
      {formatted}
      {daysLeft > 0 && ` (${daysLeft}d left)`}
      {daysLeft <= 0 && ' (Closed)'}
    </span>
  )
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: job, isLoading, isError } = useJob(id)
  const { data: applications } = useMyApplications()
  const { token } = useAuthStore()
  const navigate = useNavigate()

  const alreadyApplied = applications?.some((a) => a.job_id === id)

  const handleApplyClick = () => {
    if (!token) {
      sessionStorage.setItem('or_redirect', `/apply/${id}`)
      navigate('/register')
    } else {
      navigate(`/apply/${id}`)
    }
  }

  if (isLoading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Skeleton height="32px" width="60%" style={{ marginBottom: 12 }} />
        <Skeleton height="14px" width="40%" style={{ marginBottom: 24 }} />
        <div className="card">
          <Skeleton height="160px" />
        </div>
      </div>
    )
  }

  if (isError || !job) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link
          to="/jobs"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-primary)', marginBottom: 24, textDecoration: 'none' }}
        >
          <ArrowLeft size={16} />
          Browse Jobs
        </Link>
        <p style={{ color: 'var(--color-danger)' }}>Job not found.</p>
      </div>
    )
  }

  const isClosed = job.status !== 'active'

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Link
        to="/jobs"
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, textDecoration: 'none' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
      >
        <ArrowLeft size={15} />
        Browse Jobs
      </Link>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24 }}>
        {/* Main content */}
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <h1 className="page-title">{job.title}</h1>
            {isClosed && <span className="badge badge-neutral" style={{ alignSelf: 'center' }}>Applications Closed</span>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={14} />
              {job.location}
            </span>
            <VerdictBadge verdict={job.job_type} />
          </div>

          {/* Description */}
          <div className="card">
            <div className="panel-section-label" style={{ marginBottom: 10 }}>About this role</div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
              {job.description}
            </p>
          </div>
        </div>

        {/* Sidebar CTA */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 16 }}>
            <div style={{ marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Location</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-primary)' }}>
                  <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
                  {job.location}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Type</div>
                <VerdictBadge verdict={job.job_type} />
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Deadline</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                  <DeadlineText deadline={job.application_deadline} status={job.status} />
                </div>
              </div>
            </div>

            {/* CTA */}
            {alreadyApplied ? (
              <div
                className="badge badge-success"
                style={{ display: 'block', width: '100%', textAlign: 'center', padding: '8px 14px', fontSize: 13 }}
              >
                You've already applied
              </div>
            ) : isClosed ? (
              <p style={{ fontSize: 12, textAlign: 'center', color: 'var(--text-muted)' }}>
                This position is no longer accepting applications.
              </p>
            ) : (
              <button
                onClick={handleApplyClick}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                Apply Now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
