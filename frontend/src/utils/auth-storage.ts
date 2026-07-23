const KEY = 'lb_admin_session_token'

export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setStoredSessionToken(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
  }
}

export function clearStoredSessionToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
  }
}
