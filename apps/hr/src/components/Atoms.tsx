import React from 'react'

// ─── Badge ────────────────────────────────────────────────────────────────────
type BadgeVariant = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  )
}

// Map verdict strings to badge variants
export function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, { variant: BadgeVariant; label: string }> = {
    shortlisted:     { variant: 'success',  label: 'Shortlisted' },
    reviewing:       { variant: 'warning',  label: 'Reviewing' },
    rejected:        { variant: 'danger',   label: 'Not shortlisted' },
    not_shortlisted: { variant: 'danger',   label: 'Not shortlisted' },
    applied:         { variant: 'primary',  label: 'Applied' },
    scoring:         { variant: 'neutral',  label: 'Scoring…' },
    active:          { variant: 'primary',  label: 'Active' },
    closed:          { variant: 'neutral',  label: 'Closed' },
    draft:           { variant: 'neutral',  label: 'Draft' },
  }
  const entry = map[verdict] ?? { variant: 'neutral' as BadgeVariant, label: verdict }
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}


// ─── SkillTag ─────────────────────────────────────────────────────────────────
interface SkillTagProps {
  label: string
  matched?: boolean
  missing?: boolean
}

export function SkillTag({ label, matched, missing }: SkillTagProps) {
  let cls = 'skill-tag'
  if (matched) cls += ' skill-tag--matched'
  if (missing) cls += ' skill-tag--missing'
  return <span className={cls}>{missing ? `– ${label}` : label}</span>
}

export function SkillTagList({
  matched = [],
  missing = [],
  maxMatched = 4,
  maxMissing = 2,
}: {
  matched?: string[]
  missing?: string[]
  maxMatched?: number
  maxMissing?: number
}) {
  return (
    <div className="skill-tags">
      {matched.slice(0, maxMatched).map(s => (
        <SkillTag key={s} label={s} matched />
      ))}
      {missing.slice(0, maxMissing).map(s => (
        <SkillTag key={s} label={s} missing />
      ))}
    </div>
  )
}


// ─── StatusDot ────────────────────────────────────────────────────────────────
export function StatusDot({ status }: { status: 'ok' | 'err' | 'warn' }) {
  return <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
}


// ─── ScoreRing ────────────────────────────────────────────────────────────────
interface ScoreRingProps {
  score: number          // 0–100
  size?: number          // px, default 36
  strokeWidth?: number   // default 3.5
  showLabel?: boolean    // show number inside ring
}

export function ScoreRing({
  score,
  size = 36,
  strokeWidth = 3.5,
  showLabel = false,
}: ScoreRingProps) {
  const r = (size / 2) - strokeWidth
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ
  const offset = circ * 0.25  // start at 12 o'clock

  const color =
    score >= 75 ? 'var(--color-success)' :
    score >= 55 ? 'var(--color-primary)' :
    score >= 40 ? 'var(--color-warning)' :
                  'var(--color-danger)'

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`Score: ${score} out of 100`}
      role="img"
    >
      {/* track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="var(--bg-elevated)"
        strokeWidth={strokeWidth}
      />
      {/* fill */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      {showLabel && (
        <text
          x={size / 2}
          y={size / 2 + 4}
          fontFamily="var(--font-mono)"
          fontSize={size * 0.26}
          fontWeight="500"
          fill={color}
          textAnchor="middle"
        >
          {score}
        </text>
      )}
    </svg>
  )
}
