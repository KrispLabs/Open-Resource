import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, Calendar } from 'lucide-react'
import type { Job, JobType } from '@open-resource/shared'
import { useJobs } from '../hooks/useJobs'
import { useAuthStore } from '../store/auth'
import { VerdictBadge } from '../components/Atoms'
import { SkeletonJobCards, EmptyState, EMPTY_STATES } from '../components/Skeleton'

function DeadlineTag({ deadline, status }: { deadline: string | null; status: string }) {
  if (status !== 'active') {
    return <span className="badge badge-neutral">Applications Closed</span>
  }

  if (!deadline) {
    return <span className="deadline--ok">Open</span>
  }

  const daysLeft = Math.ceil(
    (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  const label =
    daysLeft <= 0 ? 'Closes today' : `Closes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`

  const cls = daysLeft <= 7 ? 'deadline--urgent' : 'deadline--ok'

  return (
    <span className={`flex items-center gap-1 ${cls}`}>
      <Calendar size={11} />
      {label}
    </span>
  )
}

export default function JobList() {
  const { data: jobs, isLoading, isError } = useJobs()
  const { token } = useAuthStore()
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [search, setSearch] = useState('')

  const handleApplyClick = (jobId: string) => {
    if (!token) {
      sessionStorage.setItem('or_redirect', `/apply/${jobId}`)
      navigate('/register')
    } else {
      navigate(`/apply/${jobId}`)
    }
  }

  const filtered = (jobs ?? [])
    .filter((j: Job) => {
      if (typeFilter !== 'all' && j.job_type !== typeFilter) return false
      if (search && !j.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a: Job, b: Job) => {
      const aTime = new Date(a.created_at).getTime()
      const bTime = new Date(b.created_at).getTime()
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime
    })

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Open Positions</h1>
          <p className="page-subtitle">Explore roles and apply directly</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
          <input
            type="text"
            placeholder="Search by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
            style={{ width: '100%', paddingLeft: 10 }}
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as JobType | 'all')}
          className="form-select"
          style={{ width: 'auto' }}
        >
          <option value="all">All types</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </select>

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
          className="form-select"
          style={{ width: 'auto' }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Loading */}
      {isLoading && <SkeletonJobCards count={4} />}

      {/* Error */}
      {isError && (
        <div
          className="card"
          style={{ borderColor: 'var(--color-danger)', backgroundColor: 'var(--color-danger-dim)', color: 'var(--color-danger)' }}
        >
          Failed to load job listings. Please try again later.
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="card">
          <EmptyState {...EMPTY_STATES.jobList} />
        </div>
      )}

      {/* Job cards */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="job-cards">
          {filtered.map((job: Job) => {
            const isClosed = job.status !== 'active'
            return (
              <div key={job.id} className="job-card">
                <div className="job-card-title">
                  <Link
                    to={`/jobs/${job.id}`}
                    style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                  >
                    {job.title}
                  </Link>
                </div>

                <div className="job-card-meta">
                  <span className="job-card-tag">
                    <MapPin size={11} />
                    {job.location}
                  </span>
                  <VerdictBadge verdict={job.job_type} />
                  <DeadlineTag deadline={job.application_deadline} status={job.status} />
                </div>

                <div className="job-card-footer">
                  {isClosed ? (
                    <span className="badge badge-neutral">Applications Closed</span>
                  ) : (
                    <button
                      onClick={() => handleApplyClick(job.id)}
                      className="btn btn-primary btn-sm"
                    >
                      Apply Now
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
