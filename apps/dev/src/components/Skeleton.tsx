// ─── Skeleton ─────────────────────────────────────────────────────────────────
interface SkeletonProps {
  width?: string
  height?: string
  className?: string
  style?: React.CSSProperties
}

export function Skeleton({ width = '100%', height = '14px', className = '', style }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  )
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card">
          <Skeleton height="10px" width="60%" className="skeleton-text" />
          <Skeleton height="28px" width="50%" style={{ marginTop: '6px' }} />
          <Skeleton height="10px" width="40%" style={{ marginTop: '6px' }} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTableRows({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          <td><Skeleton height="12px" width="28px" /></td>
          <td>
            <Skeleton height="13px" width="120px" />
            <Skeleton height="10px" width="80px" style={{ marginTop: '4px' }} />
          </td>
          <td><Skeleton height="32px" width="32px" style={{ borderRadius: '50%' }} /></td>
          <td><Skeleton height="20px" width="80px" /></td>
          <td><Skeleton height="16px" width="100px" /></td>
          <td><Skeleton height="16px" width="60px" /></td>
          <td><Skeleton height="24px" width="54px" /></td>
        </tr>
      ))}
    </>
  )
}

export function SkeletonJobCards({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="job-card" aria-hidden="true">
          <Skeleton height="16px" width="60%" style={{ marginBottom: '8px' }} />
          <Skeleton height="11px" width="80%" style={{ marginBottom: '10px' }} />
          <Skeleton height="1px" width="100%" style={{ marginBottom: '10px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Skeleton height="11px" width="100px" />
            <Skeleton height="28px" width="80px" style={{ borderRadius: '6px' }} />
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── EmptyState ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {action && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={action.onClick}
          style={{ marginTop: '12px' }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// Preset empty states used across portals
export const EMPTY_STATES = {
  jobList: {
    icon: '📋',
    title: 'No open positions right now',
    description: 'Check back soon — new roles are posted regularly.',
  },
  rankings: {
    icon: '🤖',
    title: 'No rankings yet',
    description: 'Close the application window to start AI screening.',
  },
  shortlist: {
    icon: '⭐',
    title: 'Shortlist is empty',
    description: 'Review the full rankings and shortlist candidates from the candidate panel.',
  },
  applications: {
    icon: '📄',
    title: "You haven't applied to any roles yet",
    description: 'Browse open positions and submit your resume.',
  },
  logs: {
    icon: '📡',
    title: 'No logs yet',
    description: 'API logs will appear here once the system processes a job.',
  },
  campaign: {
    icon: '🔍',
    title: 'No campaign launched',
    description: 'Launch a GitHub sourcing campaign to find matching developers.',
  },
} satisfies Record<string, Omit<EmptyStateProps, 'action'>>
