import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Briefcase } from 'lucide-react'
import { api } from '../api/client'

interface Job {
  id: string
  title: string
  status: string
  location: string
  job_type: string
  application_count: number
  created_at: string
}

export default function Jobs() {
  const navigate = useNavigate()
  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs').then(r => r.data),
  })

  const statusColor = (s: string): string =>
    s === 'active' ? 'var(--color-success)' :
    s === 'closed' ? 'var(--color-warning)' :
    'var(--color-text-muted)'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Jobs</h1>
        <button
          onClick={() => navigate('/jobs/new')}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--color-primary)', borderRadius: '6px' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-primary-hover)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-primary)')}
        >
          <Plus size={14} /> New Job
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center py-20">
          <Briefcase size={36} style={{ color: 'var(--color-text-muted)' }} className="mb-3" />
          <p style={{ color: 'var(--color-text-muted)' }}>No jobs yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => (
            <div
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className="flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-elevated)' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-elevated)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
            >
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{job.title}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {job.location} · {job.job_type}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span style={{ color: 'var(--color-text-muted)' }}>{job.application_count} applicants</span>
                <span style={{ color: statusColor(job.status), fontWeight: 600 }}>{job.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
