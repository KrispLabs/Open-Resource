import { create } from 'zustand'
import type { AuthUser } from './auth'

interface AuthState {
  token: string | null
  user: AuthUser | null
  setAuth: (token: string, user: AuthUser) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('or_token'),
  user: (() => {
    try {
      return JSON.parse(localStorage.getItem('or_user') ?? 'null') as AuthUser | null
    } catch {
      return null
    }
  })(),
  setAuth: (token, user) => {
    localStorage.setItem('or_token', token)
    localStorage.setItem('or_user', JSON.stringify(user))
    set({ token, user })
  },
  logout: () => {
    localStorage.removeItem('or_token')
    localStorage.removeItem('or_user')
    set({ token: null, user: null })
    try {
      const ch = new BroadcastChannel('or_auth')
      ch.postMessage({ type: 'logout' })
      ch.close()
    } catch {
      // BroadcastChannel not available in all environments
    }
  },
}))
