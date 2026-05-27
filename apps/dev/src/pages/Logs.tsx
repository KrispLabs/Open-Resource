import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import { formatDateTime } from '../utils/time'
import { StatusDot } from '../components/Atoms'
import { SkeletonTableRows, EmptyState, EMPTY_STATES } from '../components/Skeleton'

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

const EVENT_TYPES = ['all', 'jd_analysis', 'candidate_scoring', 'github_search', 'outreach_generation']
const STATUSES = ['all', 'success', 'error']
const PROVIDERS = ['all', 'featherless', 'github']
const PAGE_SIZE = 50

function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    jd_analysis: { bg: 'var(--color-primary-dim)', color: 'var(--color-primary)' },
    candidate_scoring: { bg: 'var(--color-success-dim)', color: 'var(--color-success)' },
    github_search: { bg: 'var(--color-warning-dim)', color: 'var(--color-warning)' },
    outreach_generation: { bg: 'var(--color-primary-dim)', color: 'var(--color-primary)' },
  }
  const style = colors[type] ?? { bg: 'var(--bg-elevated)', color: 'var(--text-muted)' }
  return (
    <span
      className="badge"
      style={{ backgroundColor: style.bg, color: style.color }}
    >
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

export default function Logs() {
  const [eventType, setEventType] = useState('all')
  const [status, setStatus] = useState('all')
  const [provider, setProvider] = useState('all')
  const [jobId, setJobId] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const params = new URLSearchParams()
  if (eventType !== 'all') params.set('event_type', eventType)
  if (status !== 'all') params.set('status', status)
  if (provider !== 'all') params.set('api_provider', provider)
  if (jobId.trim()) params.set('job_id', jobId.trim())
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(page * PAGE_SIZE))

  const { data, isLoading } = useQuery<LogsResponse>({
    queryKey: ['dev-logs', eventType, status, provider, jobId, page],
    queryFn: () => api.get(`/api/dev/logs?${params.toString()}`).then(r => r.data),
    refetchInterval: autoRefresh ? 10000 : false,
  })

  const logs = data?.logs ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleFilterChange = () => setPage(0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Filter bar */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 14px' }}>
        <select
          value={eventType}
          onChange={e => { setEventType(e.target.value); handleFilterChange() }}
          className="form-select"
          style={{ width: 'auto' }}
        >
          {EVENT_TYPES.map(t => (
            <option key={t} value={t}>{t === 'all' ? 'All Events' : t.replace(/_/g, ' ')}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={e => { setStatus(e.target.value); handleFilterChange() }}
          className="form-select"
          style={{ width: 'auto' }}
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>
          ))}
        </select>

        <select
          value={provider}
          onChange={e => { setProvider(e.target.value); handleFilterChange() }}
          className="form-select"
          style={{ width: 'auto' }}
        >
          {PROVIDERS.map(p => (
            <option key={p} value={p}>{p === 'all' ? 'All Providers' : p}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by Job ID…"
          value={jobId}
          onChange={e => { setJobId(e.target.value); handleFilterChange() }}
          className="form-input"
          style={{ width: '180px', fontFamily: 'var(--font-mono)' }}
        />

        <label
          style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', fontSize: '12px', cursor: 'pointer', color: 'var(--text-secondary)' }}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            style={{ accentColor: 'var(--color-primary)' }}
          />
          Auto-refresh (10s)
        </label>

        {total > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {total.toLocaleString()} entries
          </span>
        )}
      </div>

      {/* Table */}
      <div className="table-wrap">
        <div className="table-header">
          <span className="table-title">System Logs</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Timestamp</th>
              <th>Event Type</th>
              <th>Job</th>
              <th>Provider</th>
              <th>Tokens</th>
              <th>Latency</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonTableRows rows={8} />
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 0 }}>
                  <EmptyState {...EMPTY_STATES.logs} />
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <>
                  <tr
                    key={log.id}
                    style={{
                      backgroundColor: log.status === 'error' ? 'rgba(185, 28, 28, 0.05)' : undefined,
                      cursor: log.error_message ? 'pointer' : 'default',
                    }}
                    onClick={() => log.error_message && setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td>
                      <StatusDot status={log.status === 'success' ? 'ok' : 'err'} />
                    </td>
                    <td className="log-time" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(log.created_at)}
                    </td>
                    <td>
                      <EventTypeBadge type={log.event_type} />
                    </td>
                    <td className="log-tokens">
                      {log.job_id ? log.job_id.slice(0, 8) + '…' : '—'}
                    </td>
                    <td>
                      <ProviderBadge provider={log.api_provider} />
                    </td>
                    <td className="log-tokens">
                      {log.tokens_used != null ? log.tokens_used.toLocaleString() : '—'}
                    </td>
                    <td className="log-latency">
                      {log.latency_ms}ms
                    </td>
                    <td>
                      {log.error_message && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {expandedId === log.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandedId === log.id && log.error_message && (
                    <tr
                      key={`${log.id}-expanded`}
                      style={{ backgroundColor: 'rgba(185, 28, 28, 0.05)' }}
                    >
                      <td colSpan={8}>
                        <pre
                          style={{
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: 'var(--color-danger)',
                            fontFamily: 'var(--font-mono)',
                            margin: 0,
                          }}
                        >
                          {log.error_message}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderTop: '1px solid var(--border-default)',
            }}
          >
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Page {page + 1} of {totalPages} — {total.toLocaleString()} total entries
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn btn-ghost btn-sm"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn btn-ghost btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
