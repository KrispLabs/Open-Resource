import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Briefcase, Users, Clock, CheckCircle } from 'lucide-react'
import type { Job } from '@open-resource/shared'
import { api } from '../api/client'
import { SkeletonStatCards } from '../components/Skeleton'
import { EmptyState } from '../components/Skeleton'
import { VerdictBadge } from '../components/Atoms'

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs').then(r => r.data),
  })

  const active = jobs.filter(j => j.status === 'active').length
  const totalApplicants = jobs.reduce((s, j) => s + (j.application_count ?? 0), 0)
  const pendingScoring = jobs.filter(j => j.status === 'closed').length

  const stats = [
    { label: 'Total Jobs', value: jobs.length, icon: Briefcase },
    { label: 'Active Jobs', value: active, icon: Clock },
    { label: 'Total Applicants', value: totalApplicants, icon: Users },
    { label: 'Pending Scoring', value: pendingScoring, icon: CheckCircle },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Your hiring overview</p>
        </div>
        <button
          onClick={() => navigate('/jobs/new')}
          className="btn btn-primary"
        >
          <Plus size={15} /> Post New Job
        </button>
      </div>

      {/* Stat cards */}
      {isLoading ? (
        <SkeletonStatCards count={4} />
      ) : (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span className="stat-label">{label}</span>
                <Icon size={15} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="stat-value">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recent jobs */}
      <div>
        <h2 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>Recent Jobs</h2>
        {isLoading ? null : jobs.length === 0 ? (
          <div
            style={{
              border: '1px dashed var(--border-default)',
              borderRadius: '8px',
            }}
          >
            <EmptyState
              icon="📋"
              title="No jobs posted yet."
              description="Post your first job to start receiving applications."
              action={{ label: 'Post New Job', onClick: () => navigate('/jobs/new') }}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {['Title', 'Type', 'Status', 'Applicants', 'Created'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
                  >
                    <td style={{ fontWeight: 500 }}>{job.title}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{job.job_type}</td>
                    <td><VerdictBadge verdict={job.status} /></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{job.application_count}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(job.created_at).toLocaleDateString()}
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
