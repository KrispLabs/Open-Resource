import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import type { Application } from '@open-resource/shared'
import { api } from '../api/client'
import { ScoreRing, VerdictBadge } from '../components/Atoms'
import { EmptyState, EMPTY_STATES } from '../components/Skeleton'
import { useToast } from '../components/Toast'

function extractErrorMsg(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.length > 0) return detail
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; message?: string } | undefined
    return first?.msg ?? first?.message ?? fallback
  }
  return fallback
}

function exportCsv(candidates: Application[]) {
  const header = ['Rank', 'Name', 'Score', 'Verdict', 'Matched Skills']
  const rows = candidates.map((c) => [
    c.rank ?? '',
    c.applicant_name,
    c.candidate_scores?.weighted_total?.toFixed(1) ?? '',
    c.candidate_scores?.verdict ?? c.status,
    (c.candidate_scores?.matched_skills ?? []).join('; '),
  ])

  const csvContent = [header, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    )
    .join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'shortlist.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export default function Shortlist() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ['applications', id],
    queryFn: () => api.get(`/jobs/${id}/applications`).then((r) => r.data),
    enabled: !!id,
  })

  const shortlisted = applications
    .filter((a) => a.status === 'shortlisted')
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))

  const handleRemove = async (appId: string) => {
    setRemovingId(appId)
    setRemoveError(null)
    try {
      await api.patch(`/applications/${appId}`, { status: 'not_shortlisted' })
      queryClient.setQueryData<Application[]>(['applications', id], (prev) =>
        prev
          ? prev.map((a) =>
              a.id === appId ? { ...a, status: 'not_shortlisted' as Application['status'] } : a
            )
          : prev
      )
      queryClient.invalidateQueries({ queryKey: ['applications', id] })
    } catch (err: unknown) {
      const msg = extractErrorMsg(err, 'Failed to remove candidate')
      setRemoveError(msg)
      showToast(msg, 'error')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1
            style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-primary)' }}
          >
            {isLoading ? 'Shortlist' : `${shortlisted.length} candidate${shortlisted.length !== 1 ? 's' : ''} shortlisted`}
          </h1>
          <p style={{ fontSize: '13px', marginTop: '2px', color: 'var(--color-text-muted)' }}>
            Candidates selected for next steps
          </p>
        </div>
        {shortlisted.length > 0 && (
          <button
            onClick={() => exportCsv(shortlisted)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              backgroundColor: 'transparent',
              border: '1px solid var(--color-elevated)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-elevated)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>

      {removeError && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: 'var(--color-danger-dim)',
            border: '1px solid var(--color-danger)',
            fontSize: '13px',
            color: 'var(--color-danger)',
          }}
        >
          {removeError}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Loading…</div>
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
          Failed to load shortlist. Please refresh and try again.
        </div>
      ) : shortlisted.length === 0 ? (
        <div style={{ border: '1px dashed var(--border-default)', borderRadius: '8px' }}>
          <EmptyState
            {...EMPTY_STATES.shortlist}
            action={{ label: 'View Rankings', onClick: () => navigate(`/jobs/${id}/rankings`) }}
          />
        </div>
      ) : (
        <div
          style={{
            borderRadius: '8px',
            border: '1px solid var(--color-elevated)',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderBottom: '1px solid var(--color-elevated)',
                }}
              >
                {['Rank', 'Name', 'Score', 'Verdict', 'Matched Skills', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shortlisted.map((app, i) => {
                const scores = app.candidate_scores
                const isRemoving = removingId === app.id

                return (
                  <tr
                    key={app.id}
                    style={{
                      borderBottom:
                        i < shortlisted.length - 1 ? '1px solid var(--color-elevated)' : 'none',
                      backgroundColor: 'var(--color-surface)',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface)')
                    }
                  >
                    <td style={{ padding: '10px 16px', width: '52px' }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '13px',
                          fontWeight: 600,
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        #{app.rank ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {app.applicant_name}
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', width: '60px' }}>
                      {scores ? (
                        <ScoreRing score={scores.weighted_total} size={48} />
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 16px', width: '110px' }}>
                      {scores ? (
                        <VerdictBadge verdict={scores.verdict} />
                      ) : (
                        <VerdictBadge verdict={app.status} />
                      )}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {(scores?.matched_skills ?? []).slice(0, 4).map((skill) => (
                          <span
                            key={skill}
                            style={{
                              fontSize: '11px',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--color-success-dim)',
                              color: 'var(--color-success)',
                              fontWeight: 500,
                            }}
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', width: '160px' }}>
                      <button
                        onClick={() => handleRemove(app.id)}
                        disabled={isRemoving}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 500,
                          color: 'var(--color-danger)',
                          backgroundColor: 'transparent',
                          border: '1px solid var(--color-danger)',
                          cursor: isRemoving ? 'not-allowed' : 'pointer',
                          opacity: isRemoving ? 0.5 : 1,
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-danger-dim)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {isRemoving ? 'Removing…' : 'Remove from shortlist'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Back link */}
      <div style={{ marginTop: '20px' }}>
        <button
          onClick={() => navigate(`/jobs/${id}/rankings`)}
          style={{
            fontSize: '13px',
            color: 'var(--color-primary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ← Back to Rankings
        </button>
      </div>
    </div>
  )
}
