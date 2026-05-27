import { useEffect, useRef, useState, useCallback } from 'react'

export type SSEStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error'

export interface SSEEvent {
  type: 'session_start' | 'step' | 'candidate_start' | 'candidate_done' | 'session_done'
  payload: Record<string, unknown>
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function useSSE(path: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [status, setStatus] = useState<SSEStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const connect = useCallback(async (streamPath: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('connecting')
    setEvents([])
    setError(null)

    const token = localStorage.getItem('or_token')
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
      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed: SSEEvent = JSON.parse(line.slice(6))
              setEvents((prev) => [...prev, parsed])
              if (parsed.type === 'session_done') {
                setStatus('done')
                ctrl.abort()
                return
              }
            } catch {
              // ignore malformed
            }
          }
        }
      }
      setStatus('done')
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        setError('Stream connection failed')
        setStatus('error')
      }
    }
  }, [])

  useEffect(() => {
    if (!path) return
    connect(path)
    return () => abortRef.current?.abort()
  }, [path, connect])

  return { events, status, error }
}
