import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function AuthSync() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  useEffect(() => {
    const handleExpired = () => {
      logout()
      navigate('/login', { replace: true })
    }

    window.addEventListener('or:session-expired', handleExpired as EventListener)

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel('or_auth')
      channel.onmessage = (e) => {
        if (e.data?.type === 'logout') {
          logout()
          navigate('/login', { replace: true })
        }
      }
    } catch {
      // BroadcastChannel not supported in this environment
    }

    return () => {
      window.removeEventListener('or:session-expired', handleExpired as EventListener)
      channel?.close()
    }
  }, [logout, navigate])

  return null
}
