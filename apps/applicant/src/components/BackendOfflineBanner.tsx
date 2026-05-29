import { useEffect, useState, useRef } from 'react'

const HEALTHY_INTERVAL = 30_000
const UNHEALTHY_INTERVAL = 10_000
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function BackendOfflineBanner() {
  const [offline, setOffline] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true

    async function check() {
      if (!active) return
      try {
        const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5_000) })
        if (active) setOffline(!res.ok)
      } catch {
        if (active) setOffline(true)
      }
      if (active) {
        timerRef.current = setTimeout(check, offline ? UNHEALTHY_INTERVAL : HEALTHY_INTERVAL)
      }
    }

    check()
    return () => {
      active = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [offline])

  if (!offline) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: '10px 20px',
        backgroundColor: 'var(--color-warning, #B45309)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 500,
        textAlign: 'center',
        letterSpacing: '0.01em',
      }}
    >
      Backend unreachable — some features may be unavailable. Retrying…
    </div>
  )
}
