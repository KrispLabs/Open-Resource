import { NavLink, useNavigate } from 'react-router-dom'
import { Briefcase, LogOut, LayoutDashboard, Send } from 'lucide-react'
import { useAuthStore } from '../store/auth'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/campaigns', icon: Send, label: 'Campaigns' },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside
      className="flex flex-col w-56 shrink-0 h-screen border-r"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-elevated)',
      }}
    >
      {/* Logo */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--color-elevated)' }}>
        <span className="font-bold text-base tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Open Resource
        </span>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>HR Portal</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
              color: isActive ? '#fff' : 'var(--color-text-secondary)',
            })}
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t" style={{ borderColor: 'var(--color-elevated)' }}>
        <div className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{user?.name}</div>
          <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{user?.email}</div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors mt-1"
          style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'var(--color-elevated)'
            e.currentTarget.style.color = 'var(--color-danger)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-secondary)'
          }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
