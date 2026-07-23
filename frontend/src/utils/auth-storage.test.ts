import { beforeEach, describe, expect, test } from 'vitest'
import { clearStoredSessionToken, getStoredSessionToken, setStoredSessionToken } from './auth-storage'

const KEY = 'lb_admin_session_token'
const storage = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

describe('auth storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('stores and reads the session token', () => {
    setStoredSessionToken('session-token')

    expect(getStoredSessionToken()).toBe('session-token')
    expect(localStorage.getItem(KEY)).toBe('session-token')
  })

  test('clears the session token', () => {
    setStoredSessionToken('session-token')
    clearStoredSessionToken()

    expect(getStoredSessionToken()).toBeNull()
  })
})
