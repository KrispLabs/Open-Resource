import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { formatDistanceToNow } from '../utils/time'
import { SkeletonStatCards } from '../components/Skeleton'
import { StatusDot } from '../components/Atoms'

interface DevStats {
  total_jobs: number
  active_jobs: number
  closed_jobs: number
  total_applications: number
  total_scored: number
  claude_calls_today: number
  claude_tokens_today: number
  github_calls_today: number
  avg_latency_ms: number
  error_rate_today: number
  shortlisted_total: number
  not_shortlisted_total: number
}

interface SystemLog {
  id: string
  event_type: string
  job_id: string | null
  api_provider: string
  tokens_used: number | null
  latency_ms: number
  status: string
  error_message: string | null
  created_at: string
}

interface LogsResponse {
  logs: SystemLog[]
  total: number
}

const STAT_CARDS: { key: keyof DevStats; label: string; unit: string; variant?: string }[] = [
  { key: 'claude_calls_today', label: 'Claude Calls Today', unit: 'calls' },
  { key: 'claude_tokens_today', label: 'Tokens Used', unit: 'tokens' },
  { key: 'github_calls_today', label: 'GitHub API Calls', unit: 'calls' },
  { key: 'avg_latency_ms', label: 'Avg Latency', unit: 'ms' },
  { key: 'error_rate_today', label: 'Error Rate', unit: '%', variant: 'danger' },
  { key: 'active_jobs', label: 'Active Jobs', unit: 'jobs', variant: 'primary' },
]

function StatCard({ label, value, unit, variant }: { label: string; value: number; unit: string; variant?: string }) {
  const valueClass = variant
    ? `stat-value stat-value--${variant}`
    : 'stat-value'

  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={valueClass}>
        {typeof value === 'number'
          ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1))
          : '—'}
        <span style={{ fontSize: '12px', fontWeight: 400, marginLeft: '4px', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
          {unit}
        </span>
      </div>
    </div>
  )
}

function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    jd_analysis: { bg: 'var(--color-primary-dim)', color: 'var(--color-primary)' },
    candidate_scoring: { bg: 'var(--color-success-dim)', color: 'var(--color-success)' },
    github_search: { bg: 'var(--color-warning-dim)', color: 'var(--color-warning)' },
    outreach_generation: { bg: 'var(--color-primary-dim)', color: 'var(--color-primary)' },
  }
  const style = colors[type] ?? { bg: 'var(--bg-elevated)', color: 'var(--text-muted)' }

  return (
    <span className="badge" style={{ backgroundColor: style.bg, color: style.color }}>
      {type.replace(/_/g, ' ')}
    </span>
  )
}

function ProviderBadge({ provider }: { provider: string }) {
  const isGithub = provider === 'github'
  return (
    <span
      className="badge"
      style={{
        backgroundColor: isGithub ? 'var(--color-warning-dim)' : 'var(--color-primary-dim)',
        color: isGithub ? 'var(--color-warning)' : 'var(--color-primary)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {provider}
    </span>
  )
}

export default function DevDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DevStats>({
    queryKey: ['dev-stats'],
    queryFn: () => api.get('/api/dev/stats').then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: logsData, isLoading: logsLoading } = useQuery<LogsResponse>({
    queryKey: ['dev-logs-recent'],
    queryFn: () => api.get('/api/dev/logs?limit=10').then(r => r.data),
    refetchInterval: 10000,
  })

  const logs = logsData?.logs ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Stat cards */}
      {statsLoading ? (
        <SkeletonStatCards count={6} />
      ) : (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {STAT_CARDS.map(({ key, label, unit, variant }) => (
            <StatCard
              key={key}
              label={label}
              value={stats ? (stats[key] as number) ?? 0 : 0}
              unit={unit}
              variant={variant}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
        {/* Live log feed */}
        <div className="table-wrap">
          <div className="table-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="table-title">Recent Activity</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--color-success)' }}>
                <span className="pulse-dot" />
                Live
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Auto-refresh every 10s</span>
          </div>

          {logsLoading ? (
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: '32px', width: '100%' }} />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
              No API calls recorded yet. Logs appear as the system processes jobs.
            </div>
          ) : (
            <div>
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`log-row${log.status === 'error' ? ' log-row--error' : ''}`}
                >
                  <StatusDot status={log.status === 'success' ? 'ok' : 'err'} />
                  <span className="log-time">{formatDistanceToNow(log.created_at)}</span>
                  <EventTypeBadge type={log.event_type} />
                  <ProviderBadge provider={log.api_provider} />
                  <span className="log-latency">{log.latency_ms}ms</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    {log.tokens_used ? `${log.tokens_used.toLocaleString()} tokens` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active sessions panel */}
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Active Scoring Sessions
          </div>
          {stats?.active_jobs ? (
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-primary)', fontSize: '22px', fontWeight: 500 }}>
                  {stats.active_jobs}
                </span>
                {' '}active job{stats.active_jobs !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Visit All Jobs to view details.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              No active scoring sessions
            </div>
          )}

          {stats && (
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
              <div className="stat-label">Total Applications</div>
              <div className="stat-value">{stats.total_applications.toLocaleString()}</div>
              <div className="stat-delta" style={{ marginTop: '8px' }}>
                <span style={{ color: 'var(--color-success)' }}>{stats.shortlisted_total}</span> shortlisted
                {' · '}
                <span>{stats.total_scored}</span> scored
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
