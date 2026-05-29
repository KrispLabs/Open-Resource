import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Briefcase, FileText, User, LogOut } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { useAuthStore } from '../store/auth'

const navItems = [
  { to: '/jobs', icon: Briefcase, label: 'Browse Jobs' },
  { to: '/dashboard', icon: FileText, label: 'My Applications' },
  { to: '/profile', icon: User, label: 'Profile' },
]

export function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="layout-shell">
      {/* Top navbar */}
      <header className="navbar">
        <div className="navbar-logo">
          <div className="navbar-logo-icon">
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>OR</span>
          </div>
          <span className="navbar-logo-name">
            Open <span>Resource</span>
          </span>
        </div>

        <div className="navbar-actions">
          {user && (
            <div className="navbar-avatar" title={user.name}>
              {user.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="layout-body">
        {/* Desktop Sidebar */}
        <aside className="sidebar" style={{ display: 'flex' }}>
          <span className="sidebar-section-label">Navigation</span>

          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `sidebar-item${isActive ? ' active' : ''}`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          <div style={{ flex: 1 }} />

          <div className="sidebar-divider" />

          {user && (
            <div style={{ padding: '6px 12px', marginBottom: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="sidebar-item"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--color-danger)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = ''
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </aside>

        {/* Main content */}
        <main className="main-content" style={{ overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="applicant-bottom-nav">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `applicant-bottom-nav-item${isActive ? ' active' : ''}`
            }
          >
            <Icon size={20} />
            <span>{label.split(' ')[0]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
