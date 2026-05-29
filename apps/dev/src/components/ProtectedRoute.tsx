import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />

  // Clear stale non-dev tokens to prevent redirect loops
  if (user && user.role !== 'dev') {
    logout()
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
