import axios, { type AxiosInstance } from 'axios'
import { isTokenExpired } from './auth'

export function createApiClient(baseURL: string): AxiosInstance {
  const client = axios.create({ baseURL })

  // Attach token; proactively detect expiry before the request fires
  client.interceptors.request.use((config) => {
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
    (r) => r,
    (err) => {
      if (err.response?.status === 401 && err.config?.headers?.Authorization) {
        window.dispatchEvent(new CustomEvent('or:session-expired'))
      }
      return Promise.reject(err)
    },
  )

  return client
}
