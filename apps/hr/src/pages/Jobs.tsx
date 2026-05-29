import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Briefcase, Archive } from 'lucide-react'
import type { Job } from '@open-resource/shared'
import { api } from '../api/client'

const statusColor = (s: string): string =>
  s === 'active' ? 'var(--color-success)' :
  s === 'closed' ? 'var(--color-warning)' :
  s === 'sourcing' ? 'var(--color-primary)' :
  s === 'interviewing' ? 'var(--color-warning)' :
  s === 'hired' ? 'var(--color-success)' :
  'var(--color-text-muted)'

export default function Jobs() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'active' | 'archived'>('active')

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs').then(r => r.data),
  })

  const { data: archivedJobs = [], isLoading: archivedLoading } = useQuery<Job[]>({
    queryKey: ['jobs', 'archived'],
    queryFn: () => api.get('/jobs?include_archived=true').then(r => {
      const all: Job[] = r.data
      return all.filter((j: Job) => j.status === 'archived')
    }),
    enabled: tab === 'archived',
  })

  const activeLoading = isLoading
  const displayJobs = tab === 'active' ? jobs : archivedJobs
  const displayLoading = tab === 'active' ? activeLoading : archivedLoading

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

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--color-elevated)',
          marginBottom: '16px',
        }}
      >
        <button
          onClick={() => setTab('active')}
          style={{
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            color: tab === 'active' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: tab === 'active' ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          Active ({jobs.length})
        </button>
        <button
          onClick={() => setTab('archived')}
          style={{
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            color: tab === 'archived' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            borderBottom: tab === 'archived' ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          Archived ({archivedJobs.length})
        </button>
      </div>

      {displayLoading ? (
        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : displayJobs.length === 0 ? (
        tab === 'active' ? (
          <div className="flex flex-col items-center py-20">
            <Briefcase size={36} style={{ color: 'var(--color-text-muted)' }} className="mb-3" />
            <p style={{ color: 'var(--color-text-muted)' }}>No jobs yet.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center py-20">
            <Archive size={36} style={{ color: 'var(--color-text-muted)' }} className="mb-3" />
            <p style={{ color: 'var(--color-text-muted)' }}>No archived jobs.</p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {displayJobs.map(job => (
            <div
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className="flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-elevated)',
                opacity: tab === 'archived' ? 0.8 : 1,
              }}
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
                <span style={{ color: statusColor(job.status), fontWeight: 600, textTransform: 'capitalize' }}>
                  {job.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
