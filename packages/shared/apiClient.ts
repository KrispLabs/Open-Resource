import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { isTokenExpired } from './auth'
import { captureNetworkLog } from './diagnostics'

// Carry request start time through the axios config lifecycle
type TimedConfig = InternalAxiosRequestConfig & { _t?: number }

export function createApiClient(baseURL: string): AxiosInstance {
  const client = axios.create({ baseURL })

  // Attach token; proactively detect expiry before the request fires.
  // Also stamps _t for network timing (captureNetworkLog is a no-op in production).
  client.interceptors.request.use((config: TimedConfig) => {
    config._t = Date.now()

    const token = localStorage.getItem('or_token')
    if (token) {
      if (isTokenExpired(token)) {
        window.dispatchEvent(new CustomEvent('or:session-expired'))
        return Promise.reject(Object.assign(new Error('Token expired'), { isAuthError: true }))
      }
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  // On 401: only dispatch expiry event if the request carried a token
  // (guest/public requests should not trigger forced logout)
  client.interceptors.response.use(
    (r) => {
      const cfg = r.config as TimedConfig
      captureNetworkLog({
        method: (cfg.method ?? 'GET').toUpperCase(),
        url: cfg.url ?? '',
        status: r.status,
        duration_ms: cfg._t ? Date.now() - cfg._t : 0,
        request_body: cfg.data,
        response_body: r.data,
        timestamp: new Date().toISOString(),
      })
      return r
    },
    (err) => {
      const cfg = (err.config ?? {}) as TimedConfig
      captureNetworkLog({
        method: (cfg.method ?? 'UNKNOWN').toUpperCase(),
        url: cfg.url ?? '',
        status: (err.response?.status as number | undefined) ?? null,
        duration_ms: cfg._t ? Date.now() - cfg._t : 0,
        request_body: cfg.data,
        response_body: err.response?.data,
        timestamp: new Date().toISOString(),
        error: err.message as string,
      })
      if (err.response?.status === 401 && err.config?.headers?.Authorization) {
        window.dispatchEvent(new CustomEvent('or:session-expired'))
      }
      return Promise.reject(err)
    },
  )

  return client
}
