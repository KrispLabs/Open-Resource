import { useState, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import { formatDate } from '../utils/time'
import { VerdictBadge } from '../components/Atoms'
import { SkeletonTableRows, EmptyState } from '../components/Skeleton'

interface ScoringWeights {
  technical_skills: number
  experience: number
  projects: number
  education: number
  communication: number
}

interface DevJob {
  id: string
  title: string
  status: string
  creator_name: string
  creator_email: string
  application_count: number
  scored_count: number
  scoring_weights: ScoringWeights
  created_at: string
  location: string | null
  job_type: string
}

const WEIGHT_LABELS: { key: keyof ScoringWeights; label: string }[] = [
  { key: 'technical_skills', label: 'Technical' },
  { key: 'experience', label: 'Experience' },
  { key: 'projects', label: 'Projects' },
  { key: 'education', label: 'Education' },
  { key: 'communication', label: 'Comm.' },
]

function WeightsBreakdown({ weights }: { weights: ScoringWeights }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
      {WEIGHT_LABELS.map(({ key, label }) => (
        <div key={key} className="weight-row" style={{ marginBottom: 0 }}>
          <span className="weight-label" style={{ width: '90px' }}>{label}</span>
          <div
            style={{
              flex: 1,
              height: '4px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${weights[key]}%`,
                height: '100%',
                backgroundColor: 'var(--color-primary)',
                borderRadius: '2px',
                opacity: 0.75,
              }}
            />
          </div>
          <span className="weight-pct">{weights[key]}%</span>
        </div>
      ))}
    </div>
  )
}

export default function AllJobs() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery<DevJob[]>({
    queryKey: ['dev-jobs'],
    queryFn: () => api.get('/api/dev/jobs').then(r => r.data),
  })

  const jobs = data ?? []

  return (
    <div className="table-wrap">
      <div className="table-header">
        <span className="table-title">All Jobs</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {jobs.length} jobs
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Job Title</th>
            <th>HR Owner</th>
            <th>Status</th>
            <th>Applicants</th>
            <th>Scored</th>
            <th>Created</th>
            <th>Weights</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonTableRows rows={5} />
          ) : isError ? (
            <tr>
              <td colSpan={7} style={{ padding: '32px 24px', textAlign: 'center', fontSize: '13px', color: 'var(--color-danger)' }}>
                Failed to load jobs. Check your connection and try again.
              </td>
            </tr>
          ) : jobs.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ padding: 0 }}>
                <EmptyState
                  icon="💼"
                  title="No jobs created yet"
                  description="Jobs will appear here once HR users create them."
                />
              </td>
            </tr>
          ) : (
            jobs.map(job => (
              <Fragment key={job.id}>
                <tr
                  style={{
                    borderBottom: expandedId === job.id ? 'none' : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                >
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {expandedId === job.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {job.title}
                    </div>
                  </td>
                  <td>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{job.creator_name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{job.creator_email}</div>
                  </td>
                  <td>
                    <VerdictBadge verdict={job.status} />
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {job.application_count}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {job.scored_count}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {formatDate(job.created_at)}
                  </td>
                  <td>
                    <span style={{ color: 'var(--color-primary)', fontSize: '12px' }}>View</span>
                  </td>
                </tr>
                {expandedId === job.id && (
                  <tr
                    style={{ backgroundColor: 'var(--bg-hover)' }}
                  >
                    <td colSpan={7} style={{ padding: '12px 24px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Scoring Weight Breakdown
                      </div>
                      <WeightsBreakdown weights={job.scoring_weights} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
