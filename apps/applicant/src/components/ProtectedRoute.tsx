import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />

  // Only allow applicant role (or null role during initial load)
  if (user && user.role !== 'applicant') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
