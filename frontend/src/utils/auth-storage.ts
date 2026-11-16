/** Lunch/admin session from the Add Lunch page. */
export const LUNCH_SESSION_KEY = 'lb_admin_session_token'
/** Purchaser session from /chris. Kept apart so one page's token never shadows the other's. */
export const PURCHASER_SESSION_KEY = 'lb_purchaser_session_token'

export function getStoredSessionToken(key = LUNCH_SESSION_KEY): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setStoredSessionToken(token: string, key = LUNCH_SESSION_KEY): void {
  try {
    localStorage.setItem(key, token)
  } catch {
  }
}

export function clearStoredSessionToken(key = LUNCH_SESSION_KEY): void {
  try {
    localStorage.removeItem(key)
  } catch {
  }
}
