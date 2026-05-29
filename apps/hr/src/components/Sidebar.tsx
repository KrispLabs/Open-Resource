import { NavLink, useNavigate } from 'react-router-dom'
import { Briefcase, LogOut, LayoutDashboard, Send } from 'lucide-react'
import { useAuthStore } from '../store/auth'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/campaigns', icon: Send, label: 'Campaigns' },
]

const NAV_ITEM: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '7px 10px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 0.12s, color 0.12s',
  textDecoration: 'none',
  userSelect: 'none',
}

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // User initials for avatar
  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'HR'

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '216px',
        flexShrink: 0,
        height: '100vh',
        backgroundColor: 'var(--color-surface)',
        borderRight: '1px solid var(--color-elevated)',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '16px 16px 14px',
          borderBottom: '1px solid var(--color-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '6px',
              backgroundColor: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.02em' }}>OR</span>
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
              Open Resource
            </div>
            <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--color-primary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: '1px' }}>
              HR Portal
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              ...NAV_ITEM,
              backgroundColor: isActive ? 'var(--color-primary-dim)' : 'transparent',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              fontWeight: isActive ? 600 : 500,
            })}
            onMouseEnter={e => {
              const el = e.currentTarget
              if (!el.getAttribute('aria-current')) {
                el.style.backgroundColor = 'var(--color-elevated)'
                el.style.color = 'var(--color-text-primary)'
              }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              if (!el.getAttribute('aria-current')) {
                el.style.backgroundColor = 'transparent'
                el.style.color = 'var(--color-text-secondary)'
              }
            }}
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div
        style={{
          padding: '10px 8px 12px',
          borderTop: '1px solid var(--color-elevated)',
        }}
      >
        {/* User info row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            padding: '6px 10px',
            marginBottom: '4px',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: 'var(--color-primary-dim)',
              border: '1px solid var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-primary)' }}>{initials}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
              {user?.name ?? 'HR Manager'}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user?.email}
            </div>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          style={{
            ...NAV_ITEM,
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-muted)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'var(--color-danger-dim)'
            e.currentTarget.style.color = 'var(--color-danger)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
