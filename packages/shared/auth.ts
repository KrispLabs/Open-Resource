import type { UserRole } from './types'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    // 30-second buffer — proactively flag expiry before the exact moment
    return payload.exp * 1000 < Date.now() - 30_000
  } catch {
    return true
  }
}
