const MAX_BROWSER = 500
const MAX_NETWORK = 500
const MAX_REACT = 100
const MAX_PAYLOAD = 2048

export interface BrowserLog {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: string
}

export interface NetworkLog {
  method: string
  url: string
  status: number | null
  duration_ms: number
  request_body: unknown
  response_body: unknown
  timestamp: string
  error?: string
}

export interface ReactError {
  message: string
  error_stack?: string
  component_stack?: string
  route: string
  timestamp: string
}

export interface DiagnosticsSnapshot {
  portal: string
  currentRoute: string
  exportedAt: string
  authState: { email: string | null; role: string | null; tokenPresent: boolean }
  browserLogs: BrowserLog[]
  networkLogs: NetworkLog[]
  reactErrors: ReactError[]
}

type StoreArrays = {
  portal: string
  browserLogs: BrowserLog[]
  networkLogs: NetworkLog[]
  reactErrors: ReactError[]
}

declare global {
  interface Window {
    OR_DIAGNOSTICS?: StoreArrays & {
      authState: DiagnosticsSnapshot['authState']
      currentRoute: string
    }
  }
}

// Null in production — initDiagnostics is never called (guarded by import.meta.env.DEV
// at each portal's main.tsx). All capture functions below are safe no-ops when null.
let _store: StoreArrays | null = null

function cap<T>(arr: T[], entry: T, max: number): void {
  arr.push(entry)
  if (arr.length > max) arr.shift()
}

function shrink(data: unknown): unknown {
  if (data == null) return data
  let str: string
  try {
    str = typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    str = String(data)
  }
  if (str.length <= MAX_PAYLOAD) return data
  return `[${str.length}B — truncated] ${str.slice(0, MAX_PAYLOAD)}`
}

function readAuth(): DiagnosticsSnapshot['authState'] {
  try {
    const raw = localStorage.getItem('or_user')
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    return {
      email: (parsed?.email as string) ?? null,
      role: (parsed?.role as string) ?? null,
      tokenPresent: !!localStorage.getItem('or_token'),
    }
  } catch {
    return { email: null, role: null, tokenPresent: false }
  }
}

/**
 * Call once at app startup — ONLY in dev builds.
 * Each portal's main.tsx guards this with `if (import.meta.env.DEV)`.
 */
export function initDiagnostics(portal: 'hr' | 'applicant' | 'dev'): void {
  if (_store) return // already initialised

  const arrays: StoreArrays = {
    portal,
    browserLogs: [],
    networkLogs: [],
    reactErrors: [],
  }
  _store = arrays

  // Expose live object on window — authState and currentRoute are getter-computed
  const exposed = arrays as typeof window.OR_DIAGNOSTICS
  Object.defineProperty(exposed, 'authState', { get: readAuth, enumerable: true })
  Object.defineProperty(exposed, 'currentRoute', {
    get: (): string => window.location.pathname,
    enumerable: true,
  })
  window.OR_DIAGNOSTICS = exposed

  // Wrap console — chain originals so DevTools output is unchanged
  ;(['log', 'warn', 'error'] as const).forEach((level) => {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      orig(...args)
      cap(
        arrays.browserLogs,
        {
          level,
          message: args
            .map((a) => {
              try {
                return typeof a === 'string' ? a : JSON.stringify(a)
              } catch {
                return String(a)
              }
            })
            .join(' '),
          timestamp: new Date().toISOString(),
        },
        MAX_BROWSER,
      )
    }
  })

  // Uncaught synchronous JS errors
  const prevOnError = window.onerror
  window.onerror = (msg, src, line, col, err) => {
    cap(
      arrays.browserLogs,
      {
        level: 'error',
        message: `[onerror] ${msg} (${src ?? ''}:${line ?? 0}:${col ?? 0})${err?.stack ? `\n${err.stack}` : ''}`,
        timestamp: new Date().toISOString(),
      },
      MAX_BROWSER,
    )
    return typeof prevOnError === 'function' ? prevOnError(msg, src, line, col, err) : false
  }

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    cap(
      arrays.browserLogs,
      {
        level: 'error',
        message:
          r instanceof Error
            ? `[unhandledrejection] ${r.message}\n${r.stack ?? ''}`
            : `[unhandledrejection] ${String(r)}`,
        timestamp: new Date().toISOString(),
      },
      MAX_BROWSER,
    )
  })
}

export function captureNetworkLog(entry: {
  method: string
  url: string
  status: number | null
  duration_ms: number
  request_body?: unknown
  response_body?: unknown
  timestamp: string
  error?: string
}): void {
  if (!_store) return
  const record: NetworkLog = {
    method: entry.method,
    url: entry.url,
    status: entry.status,
    duration_ms: entry.duration_ms,
    request_body: shrink(entry.request_body),
    response_body: shrink(entry.response_body),
    timestamp: entry.timestamp,
  }
  if (entry.error) record.error = entry.error
  cap(_store.networkLogs, record, MAX_NETWORK)
}

export function captureReactError(entry: ReactError): void {
  if (!_store) return
  cap(_store.reactErrors, entry, MAX_REACT)
}

export function exportDiagnostics(): DiagnosticsSnapshot | null {
  if (!_store) return null
  return {
    portal: _store.portal,
    currentRoute: window.location.pathname,
    exportedAt: new Date().toISOString(),
    authState: readAuth(),
    browserLogs: [..._store.browserLogs],
    networkLogs: [..._store.networkLogs],
    reactErrors: [..._store.reactErrors],
  }
}
