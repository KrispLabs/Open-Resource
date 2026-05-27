import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Briefcase, ScrollText, Sliders, BarChart2, LogOut,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { ThemeToggle } from './ThemeToggle'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { to: '/jobs', icon: Briefcase, label: 'All Jobs' },
  { to: '/logs', icon: ScrollText, label: 'System Logs' },
  { to: '/scoring-config', icon: Sliders, label: 'Scoring Config' },
  { to: '/api-usage', icon: BarChart2, label: 'API Usage' },
]

const pageTitles: Record<string, string> = {
  '/dashboard': 'Overview',
  '/jobs': 'All Jobs',
  '/logs': 'System Logs',
  '/scoring-config': 'Scoring Config',
  '/api-usage': 'API Usage',
}

export function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const pageTitle = pageTitles[location.pathname] ?? 'Dev Console'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-base)' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '220px',
          flexShrink: 0,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-default)',
        }}
      >
        {/* Brand */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-default)' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
            Open Resource
          </span>
          <div style={{ fontSize: '11px', marginTop: '2px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Dev Console
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* System status */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span
              style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'var(--color-success)', flexShrink: 0, display: 'inline-block' }}
            />
            All systems operational
          </div>
        </div>

        {/* User + logout */}
        <div style={{ padding: '8px', borderTop: '1px solid var(--border-default)' }}>
          <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
          <button
            onClick={handleLogout}
            className="sidebar-item"
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-danger)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = ''
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        {/* Top bar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '48px',
            padding: '0 24px',
            backgroundColor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-default)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {pageTitle}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {user?.email}
            </span>
            <ThemeToggle />
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
