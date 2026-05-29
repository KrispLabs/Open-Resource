import { useState } from 'react'
import { ChevronDown, ChevronUp, Star, MapPin, Edit2, Check } from 'lucide-react'
import type { OutboundCandidate, OutreachStatus } from '@open-resource/shared'
import { ScoreRing } from './Atoms'

interface OutboundCandidateCardProps {
  candidate: OutboundCandidate
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  PHP: '#4F5D95',
  Shell: '#89e051',
  Vue: '#41b883',
  Dart: '#00B4AB',
  Scala: '#c22d40',
}

function outreachStatusConfig(status: OutreachStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', color: 'var(--color-primary)', bg: 'var(--color-primary-dim)' }
    case 'sent':
      return { label: 'Sent', color: 'var(--color-success)', bg: 'var(--color-success-dim)' }
    case 'opened':
      return { label: 'Opened', color: 'var(--color-warning)', bg: 'var(--color-warning-dim)' }
    case 'replied':
      return { label: 'Replied', color: 'var(--color-success)', bg: 'var(--color-success-dim)' }
    default:
      return { label: status, color: 'var(--color-text-muted)', bg: 'rgba(92,99,112,0.15)' }
  }
}

function LanguageTag({ lang }: { lang: string }) {
  const color = LANGUAGE_COLORS[lang] ?? 'var(--color-text-muted)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 7px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 500,
        backgroundColor: 'var(--color-elevated)',
        color: 'var(--color-text-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {lang}
    </span>
  )
}

export function OutboundCandidateCard({ candidate }: OutboundCandidateCardProps) {
  const [emailOpen, setEmailOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [emailText, setEmailText] = useState(candidate.outreach_email)

  const displayName = candidate.name ?? `@${candidate.github_username}`
  const statusCfg = outreachStatusConfig(candidate.outreach_status)

  const MAX_MATCHED = 3
  const MAX_GAP = 3
  const extraMatched = Math.max(0, candidate.matched_signals.length - MAX_MATCHED)
  const extraGap = Math.max(0, candidate.gap_signals.length - MAX_GAP)

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-elevated)',
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header: avatar + name + location */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <a
          href={candidate.github_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flexShrink: 0 }}
          tabIndex={-1}
        >
          <img
            src={`https://avatars.githubusercontent.com/${candidate.github_username}`}
            alt={candidate.github_username}
            width={48}
            height={48}
            style={{
              borderRadius: '50%',
              border: '2px solid var(--color-elevated)',
              display: 'block',
            }}
          />
        </a>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <a
              href={candidate.github_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </a>
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              marginTop: '1px',
            }}
          >
            @{candidate.github_username}
          </div>
          {candidate.location && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                marginTop: '3px',
              }}
            >
              <MapPin size={10} />
              {candidate.location}
            </div>
          )}
        </div>
        {/* Score ring top-right */}
        <div style={{ flexShrink: 0 }}>
          <ScoreRing score={candidate.profile_score} size={48} />
        </div>
      </div>

      {/* Languages */}
      {candidate.top_languages.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {candidate.top_languages.slice(0, 5).map((lang) => (
            <LanguageTag key={lang} lang={lang} />
          ))}
        </div>
      )}

      {/* Notable repos */}
      {candidate.notable_repos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {candidate.notable_repos.slice(0, 2).map((repo) => (
            <div
              key={repo.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-primary)',
                  fontWeight: 500,
                }}
              >
                {repo.name}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  color: 'var(--color-text-muted)',
                  fontSize: '11px',
                }}
              >
                <Star size={10} />
                {repo.stars.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Signals */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Matched */}
        {candidate.matched_signals.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            {candidate.matched_signals.slice(0, MAX_MATCHED).map((sig) => (
              <span
                key={sig}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  backgroundColor: 'var(--color-success-dim)',
                  color: 'var(--color-success)',
                }}
              >
                ✓ {sig}
              </span>
            ))}
            {extraMatched > 0 && (
              <span
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--color-text-muted)',
                  backgroundColor: 'var(--color-elevated)',
                }}
              >
                +{extraMatched} more
              </span>
            )}
          </div>
        )}

        {/* Gaps */}
        {candidate.gap_signals.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            {candidate.gap_signals.slice(0, MAX_GAP).map((sig) => (
              <span
                key={sig}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  backgroundColor: 'var(--color-warning-dim)',
                  color: 'var(--color-warning)',
                }}
              >
                − {sig}
              </span>
            ))}
            {extraGap > 0 && (
              <span
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--color-text-muted)',
                  backgroundColor: 'var(--color-elevated)',
                }}
              >
                +{extraGap} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Preview Email toggle */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setEmailOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
          >
            {emailOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Preview Email
          </button>
          {emailOpen && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--color-primary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0',
              }}
            >
              <Edit2 size={11} /> Edit
            </button>
          )}
          {emailOpen && editing && (
            <button
              onClick={() => setEditing(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--color-success)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0',
              }}
            >
              <Check size={11} /> Save
            </button>
          )}
        </div>

        {emailOpen && (
          <div style={{ marginTop: '8px' }}>
            {editing ? (
              <textarea
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                rows={10}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-elevated)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  lineHeight: 1.6,
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                  whiteSpace: 'pre',
                }}
              />
            ) : (
              <pre
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-elevated)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto',
                }}
              >
                {emailText}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Card footer: status badge + sent_at */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '10px',
          borderTop: '1px solid var(--color-elevated)',
        }}
      >
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            color: statusCfg.color,
            backgroundColor: statusCfg.bg,
          }}
        >
          {statusCfg.label}
        </span>
        {candidate.sent_at && (
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            Sent {new Date(candidate.sent_at).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}
