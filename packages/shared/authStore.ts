import { create } from 'zustand'
import type { AuthUser } from './auth'

interface AuthState {
  token: string | null
  user: AuthUser | null
  setAuth: (token: string, user: AuthUser) => void
  /** User-initiated logout: clears local state AND notifies other tabs. */
  logout: () => void
  /**
   * Local-only session clear — NEVER broadcasts. Used by cross-tab logout
   * receivers and the token-expiry handler so that reacting to a logout event
   * cannot itself emit another logout event (which previously caused an
   * unbounded BroadcastChannel message storm and crashed the tab).
   */
  clearSession: () => void
}

function readStoredUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem('or_user') ?? 'null') as AuthUser | null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('or_token'),
  user: readStoredUser(),
  setAuth: (token, user) => {
    localStorage.setItem('or_token', token)
    localStorage.setItem('or_user', JSON.stringify(user))
    set({ token, user })
  },
  clearSession: () => {
    // Idempotent: bail out if already cleared so repeated calls are free no-ops.
    if (get().token === null && get().user === null) return
    localStorage.removeItem('or_token')
    localStorage.removeItem('or_user')
    set({ token: null, user: null })
  },
  logout: () => {
    const hadSession = get().token !== null || get().user !== null
    localStorage.removeItem('or_token')
    localStorage.removeItem('or_user')
    set({ token: null, user: null })
    // Only notify other tabs when we actually ended a live session. This guard,
    // combined with receivers calling clearSession() (not logout()), guarantees
    // a logout message can never echo back into another logout message.
    if (hadSession) {
      try {
        const ch = new BroadcastChannel('or_auth')
        ch.postMessage({ type: 'logout' })
        ch.close()
      } catch {
        // BroadcastChannel not available in all environments
      }
    }
  },
}))
