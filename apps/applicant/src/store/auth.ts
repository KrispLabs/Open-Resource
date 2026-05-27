import { create } from 'zustand'

interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

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
      return JSON.parse(localStorage.getItem('or_user') ?? 'null')
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
  },
}))
