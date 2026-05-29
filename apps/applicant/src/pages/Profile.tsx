import { useNavigate } from 'react-router-dom'
import { User, LogOut } from 'lucide-react'
import { useAuthStore } from '../store/auth'

export default function Profile() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Profile
        </h1>
      </div>

      <div
        className="p-5 rounded-lg border"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-primary-dim)' }}
          >
            <User size={24} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {user?.name}
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {user?.email}
            </div>
          </div>
        </div>

        <div
          className="pt-4 border-t"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{
              backgroundColor: 'var(--color-danger-dim)',
              color: 'var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-danger)',
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
