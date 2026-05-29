import { useEffect, useRef, useState, useCallback } from 'react'

export type SSEStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error'

export interface SSEEvent {
  type: 'session_start' | 'step' | 'candidate_start' | 'candidate_done' | 'session_done'
  payload: Record<string, unknown>
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const HEARTBEAT_TIMEOUT_MS = 150_000  // mark error if no data in 2.5 min
const MAX_RECONNECT_DELAY_MS = 30_000

export function useSSE(path: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [status, setStatus] = useState<SSEStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const reconnectAttemptRef = useRef(0)
  const heartbeatRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearTimeout(heartbeatRef.current)
    heartbeatRef.current = setTimeout(() => {
      setError('Stream idle — no data received. Reconnecting...')
      setStatus('error')
      abortRef.current?.abort()
    }, HEARTBEAT_TIMEOUT_MS)
  }, [])

  const connect = useCallback(async (streamPath: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('connecting')
    setEvents([])
    setError(null)
    reconnectAttemptRef.current = 0

    const token = localStorage.getItem('or_token')

    const attemptConnect = async (): Promise<void> => {
      if (ctrl.signal.aborted) return
      try {
        const resp = await fetch(`${BASE_URL}${streamPath}`, {
          headers: {
            Authorization: `Bearer ${token ?? ''}`,
            Accept: 'text/event-stream',
          },
          signal: ctrl.signal,
        })

        if (!resp.ok) {
          setError(`HTTP ${resp.status}`)
          setStatus('error')
          return
        }

        setStatus('streaming')
        resetHeartbeat()

        const reader = resp.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          resetHeartbeat()
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed: SSEEvent = JSON.parse(line.slice(6))
                setEvents((prev) => [...prev, parsed])
                if (parsed.type === 'session_done') {
                  if (heartbeatRef.current) clearTimeout(heartbeatRef.current)
                  setStatus('done')
                  ctrl.abort()
                  reconnectAttemptRef.current = 0
                  return
                }
              } catch {
                // ignore malformed line
              }
            }
          }
        }
        // Stream ended normally without session_done
        setStatus('done')
        if (heartbeatRef.current) clearTimeout(heartbeatRef.current)

      } catch (err: unknown) {
        if (heartbeatRef.current) clearTimeout(heartbeatRef.current)
        if ((err as Error)?.name === 'AbortError') return

        const attempt = reconnectAttemptRef.current
        reconnectAttemptRef.current += 1
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS)
        setError(`Connection lost. Reconnecting in ${Math.round(delay / 1000)}s...`)
        setStatus('error')
        // Clear events before reconnect: the server re-sends the full stream from
        // the beginning on reconnect, so keeping old events would duplicate them.
        // ScoringStream's cardMap deduplicates by index, but the raw array would
        // grow unboundedly across multiple reconnects.
        setEvents([])

        await new Promise<void>((resolve) => {
          const tid = setTimeout(resolve, delay)
          ctrl.signal.addEventListener('abort', () => { clearTimeout(tid); resolve() })
        })
        if (!ctrl.signal.aborted) {
          setStatus('connecting')
          setError(null)
          await attemptConnect()
        }
      }
    }

    await attemptConnect()
  }, [resetHeartbeat])

  useEffect(() => {
    if (!path) return
    connect(path)
    return () => {
      abortRef.current?.abort()
      if (heartbeatRef.current) clearTimeout(heartbeatRef.current)
    }
  }, [path, connect])

  return { events, status, error }
}
