import axios from 'axios'

export const USE_MOCK = false

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
})

// Attach token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('or_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirect to /login on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('or_token')
      localStorage.removeItem('or_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
