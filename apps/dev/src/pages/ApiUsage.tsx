import { useQuery } from '@tanstack/react-query'
import { useRef, useEffect, useState } from 'react'
import { api } from '../api/client'
import { formatDate } from '../utils/time'
import { SkeletonStatCards, EmptyState } from '../components/Skeleton'

interface DayUsage {
  date: string
  claude_calls: number
  claude_tokens: number
  github_calls: number
  errors: number
}

function BarChart({ data }: { data: DayUsage[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: DayUsage } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const chartH = 200
  const paddingLeft = 52
  const paddingRight = 16
  const paddingTop = 12
  const paddingBottom = 28

  const chartW = width - paddingLeft - paddingRight

  const maxTokens = Math.max(...data.map(d => d.claude_tokens), 1)
  const maxGithub = Math.max(...data.map(d => d.github_calls), 1)
  const globalMax = Math.max(maxTokens, maxGithub, 1)

  const gridLines = 4
  const gridStep = Math.ceil(globalMax / gridLines)

  const barGroupW = chartW / Math.max(data.length, 1)
  const barW = Math.max(4, barGroupW * 0.35)

  const scaleY = (v: number) => chartH - paddingBottom - (v / (gridStep * gridLines)) * (chartH - paddingTop - paddingBottom)

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <svg
        width={width}
        height={chartH}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Grid lines */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const yVal = gridStep * i
          const y = scaleY(yVal)
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                x2={paddingLeft + chartW}
                y1={y}
                y2={y}
                stroke="var(--border-default)"
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <text
                x={paddingLeft - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {yVal >= 1000 ? `${(yVal / 1000).toFixed(0)}k` : yVal}
              </text>
            </g>
          )
        })}

        {/* Bars */}
        {data.map((day, i) => {
          const centerX = paddingLeft + i * barGroupW + barGroupW / 2
          const tokenH = Math.max(2, ((day.claude_tokens) / (gridStep * gridLines)) * (chartH - paddingTop - paddingBottom))
          const githubH = Math.max(2, ((day.github_calls) / (gridStep * gridLines)) * (chartH - paddingTop - paddingBottom))
          const baseY = chartH - paddingBottom

          const tokenX = centerX - barW - 1
          const githubX = centerX + 1

          return (
            <g
              key={day.date}
              style={{ cursor: 'crosshair' }}
              onMouseEnter={e => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setTooltip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  day,
                })
              }}
            >
              {/* Claude tokens bar */}
              <rect
                x={tokenX}
                y={baseY - tokenH}
                width={barW}
                height={tokenH}
                fill="var(--color-primary)"
                rx={2}
                opacity={0.85}
              />
              {/* GitHub calls bar */}
              <rect
                x={githubX}
                y={baseY - githubH}
                width={barW}
                height={githubH}
                fill="var(--color-success)"
                rx={2}
                opacity={0.85}
              />
              {/* X-axis label — every other day */}
              {i % 2 === 0 && (
                <text
                  x={centerX}
                  y={baseY + 16}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text-muted)"
                >
                  {day.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y - 10,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 10px',
            fontSize: '12px',
            color: 'var(--text-primary)',
            pointerEvents: 'none',
            zIndex: 10,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{tooltip.day.date}</div>
          <div>
            <span style={{ color: 'var(--color-primary)' }}>Claude tokens: </span>
            {tooltip.day.claude_tokens.toLocaleString()}
          </div>
          <div>
            <span style={{ color: 'var(--color-success)' }}>GitHub calls: </span>
            {tooltip.day.github_calls}
          </div>
          {tooltip.day.errors > 0 && (
            <div>
              <span style={{ color: 'var(--color-danger)' }}>Errors: </span>
              {tooltip.day.errors}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: 'var(--color-primary)', opacity: 0.85, display: 'inline-block' }} />
          Claude Tokens
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: 'var(--color-success)', opacity: 0.85, display: 'inline-block' }} />
          GitHub API Calls
        </span>
      </div>
    </div>
  )
}

export default function ApiUsage() {
  const { data, isLoading, isError } = useQuery<DayUsage[]>({
    queryKey: ['dev-api-usage'],
    queryFn: () => api.get('/api/dev/api-usage').then(r => r.data),
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <SkeletonStatCards count={3} />
        <div className="skeleton" style={{ height: '260px', width: '100%' }} />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="table-wrap">
        <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: '13px', color: 'var(--color-danger)' }}>
          Failed to load usage data. Backend may be unreachable.
        </div>
      </div>
    )
  }

  if (!data || data.every(d => d.claude_calls === 0 && d.github_calls === 0)) {
    return (
      <div className="table-wrap">
        <EmptyState
          icon="📊"
          title="No usage data yet"
          description="Usage data will appear after the first scoring session."
        />
      </div>
    )
  }

  const totalClaudeCalls = data.reduce((s, d) => s + d.claude_calls, 0)
  const totalTokens = data.reduce((s, d) => s + d.claude_tokens, 0)
  const peakDay = data.reduce((best, d) => (d.claude_tokens > best.claude_tokens ? d : best), data[0])
  const errorDays = data.filter(d => d.errors > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Summary cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Total Claude Calls (14 days)</div>
          <div className="stat-value">{totalClaudeCalls.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Tokens Used</div>
          <div className="stat-value">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Peak Day</div>
          <div className="stat-value" style={{ fontSize: '16px' }}>
            {peakDay ? formatDate(peakDay.date) : '—'}
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '16px' }}>
          Activity — Last 14 Days
        </div>
        <BarChart data={data} />
      </div>

      {/* Error table */}
      <div className="table-wrap">
        <div className="table-header">
          <span className="table-title">Error Days</span>
        </div>
        {errorDays.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
            No errors recorded in the last 14 days.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Error Count</th>
              </tr>
            </thead>
            <tbody>
              {errorDays.map(day => (
                <tr key={day.date}>
                  <td className="log-time">{formatDate(day.date)}</td>
                  <td>
                    <span className="badge badge-danger">
                      {day.errors} error{day.errors !== 1 ? 's' : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
