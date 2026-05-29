import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />

  // Clear stale non-HR token to prevent redirect loops
  if (user && user.role !== 'hr') {
    logout()
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
