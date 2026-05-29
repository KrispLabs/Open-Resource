import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function AuthSync() {
  // Use clearSession (local-only) here — NEVER logout(). Reacting to an expiry
  // or a cross-tab logout must not re-broadcast, or two AuthSync channels would
  // ping-pong logout messages and storm the main thread into a tab crash.
  const clearSession = useAuthStore((s) => s.clearSession)
  const navigate = useNavigate()

  useEffect(() => {
    const handleExpired = () => {
      clearSession()
      navigate('/login', { replace: true })
    }

    window.addEventListener('or:session-expired', handleExpired as EventListener)

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel('or_auth')
      channel.onmessage = (e) => {
        if (e.data?.type === 'logout') {
          clearSession()
          navigate('/login', { replace: true })
        }
      }
    } catch {
      // BroadcastChannel not available in this environment
    }

    return () => {
      window.removeEventListener('or:session-expired', handleExpired as EventListener)
      channel?.close()
    }
  }, [clearSession, navigate])

  return null
}
