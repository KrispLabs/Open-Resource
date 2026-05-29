import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user, clearSession } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />

  // Clear stale non-applicant tokens to prevent redirect loops.
  // Use clearSession (local-only) — broadcasting from inside render would emit
  // a logout event on every render until the redirect settles.
  if (user && user.role !== 'applicant') {
    clearSession()
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
