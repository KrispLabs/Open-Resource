import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ChevronRight, Trophy, Users, TrendingUp, Clock } from 'lucide-react'
import type { Application, Verdict } from '@open-resource/shared'
import { api } from '../api/client'
import { ScoreRing, VerdictBadge, SkillTagList } from '../components/Atoms'
import { SkeletonTableRows, EmptyState, EMPTY_STATES } from '../components/Skeleton'
import { CandidatePanel } from '../components/CandidatePanel'
import { useRankingsStore } from '../store/rankings'

export default function Rankings() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const { candidates, setCandidates, updateCandidate } = useRankingsStore()

  const { data, isLoading, error } = useQuery<Application[]>({
    queryKey: ['applications', id],
    queryFn: () => api.get(`/jobs/${id}/applications`).then((r) => r.data),
    enabled: !!id,
  })

  useEffect(() => {
    if (data) setCandidates(data)
  }, [data, setCandidates])

  const scored = candidates.filter((c) => c.candidate_scores !== null)
  const shortlisted = candidates.filter((c) => c.status === 'shortlisted').length
  const reviewing = candidates.filter((c) => c.status === 'reviewing').length
  const avgScore =
    scored.length > 0
      ? scored.reduce((s, c) => s + (c.candidate_scores?.weighted_total ?? 0), 0) / scored.length
      : 0

  const stats = [
    { label: 'Total Screened', value: scored.length, icon: Users },
    { label: 'Shortlisted', value: shortlisted, icon: Trophy },
    { label: 'Average Score', value: avgScore.toFixed(1), icon: TrendingUp, mono: true },
    { label: 'Reviewing', value: reviewing, icon: Clock },
  ]

  const lowerFilter = filter.toLowerCase()
  const filtered = candidates
    .filter((c) => c.candidate_scores !== null)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .filter((c) => {
      if (!lowerFilter) return true
      if (c.applicant_name.toLowerCase().includes(lowerFilter)) return true
      const skills = c.candidate_scores?.matched_skills ?? []
      return skills.some((s) => s.toLowerCase().includes(lowerFilter))
    })

  const selectedCandidate = selectedId ? candidates.find((c) => c.id === selectedId) ?? null : null

  const handleVerdictChange = (
    appId: string,
    status: Application['status'],
    verdict: Verdict
  ) => {
    // Find the specific candidate being changed by appId, not by selectedCandidate.
    // selectedCandidate reflects the currently open slide-over, which may differ
    // from the candidate whose verdict is being updated (e.g. during rapid changes).
    const target = candidates.find((c) => c.id === appId)
    updateCandidate(appId, {
      status,
      ...(target?.candidate_scores && {
        candidate_scores: { ...target.candidate_scores, verdict },
      }),
    })
    // Invalidate so Shortlist and any sibling view of this job's applications
    // reflect the verdict change on their next render (staleTime = 30s, no windowFocus refetch).
    queryClient.invalidateQueries({ queryKey: ['applications', id] })
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Rankings</h1>
          <p className="page-subtitle">AI-scored candidate rankings for this job</p>
        </div>
        <button
          className="btn btn-success"
          onClick={() => navigate(`/jobs/${id}/shortlist`)}
        >
          View Shortlist
        </button>
      </div>

      {/* Stats row */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {stats.map(({ label, value, icon: Icon, mono }) => (
          <div key={label} className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span className="stat-label">{label}</span>
              <Icon size={14} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div
              className="stat-value"
              style={{ fontFamily: mono ? 'var(--font-mono)' : undefined }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '340px' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Filter by name or skill…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="search-input"
            style={{ paddingLeft: '32px', width: '100%' }}
          />
        </div>
        {filter && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="table-wrap">
          <table>
            <thead>
              <TableHead />
            </thead>
            <tbody>
              <SkeletonTableRows rows={5} />
            </tbody>
          </table>
        </div>
      ) : error ? (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '8px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-dim)',
            fontSize: '13px',
            color: 'var(--color-danger)',
          }}
        >
          Failed to load candidates. Please refresh and try again.
        </div>
      ) : scored.length === 0 ? (
        <div className="table-wrap">
          <EmptyState
            {...EMPTY_STATES.rankings}
            action={{ label: 'Go to Job', onClick: () => navigate(`/jobs/${id}`) }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="table-wrap">
          <EmptyState title="No matches" description="No candidates match your filter." />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <TableHead />
            </thead>
            <tbody>
              {filtered.map((app) => {
                const isSelected = selectedId === app.id
                const scores = app.candidate_scores!

                return (
                  <tr
                    key={app.id}
                    onClick={() => setSelectedId(isSelected ? null : app.id)}
                    className={isSelected ? 'row-selected' : ''}
                    style={{
                      borderLeft: isSelected ? '2px solid var(--color-primary)' : '2px solid transparent',
                      transition: 'background-color 120ms',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'var(--bg-hover)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = ''
                    }}
                  >
                    {/* Rank */}
                    <td style={{ width: '52px' }}>
                      <span className={`rank-num${(app.rank ?? 99) <= 3 ? ' rank-num--top' : ''}`}>
                        #{app.rank ?? '—'}
                      </span>
                    </td>

                    {/* Name */}
                    <td>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {app.applicant_name}
                      </div>
                    </td>

                    {/* Score ring */}
                    <td style={{ width: '60px' }}>
                      <ScoreRing score={scores.weighted_total} size={36} strokeWidth={3.5} showLabel />
                    </td>

                    {/* Verdict */}
                    <td style={{ width: '110px' }}>
                      <VerdictBadge verdict={scores.verdict} />
                    </td>

                    {/* Matched + missing skills */}
                    <td colSpan={2}>
                      <SkillTagList
                        matched={scores.matched_skills}
                        missing={scores.missing_skills}
                        maxMatched={4}
                        maxMissing={2}
                      />
                    </td>

                    {/* Arrow */}
                    <td style={{ width: '40px', textAlign: 'right' }}>
                      <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Candidate Panel */}
      <CandidatePanel
        application={selectedCandidate}
        totalCandidates={scored.length}
        onClose={() => setSelectedId(null)}
        onVerdictChange={handleVerdictChange}
      />
    </div>
  )
}

function TableHead() {
  const headers = ['Rank', 'Name', 'Score', 'Verdict', 'Skills', '', '']
  return (
    <tr>
      {headers.map((h, i) => (
        <th key={i}>{h}</th>
      ))}
    </tr>
  )
}
