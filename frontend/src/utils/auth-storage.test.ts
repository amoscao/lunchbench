import { beforeEach, describe, expect, test } from 'vitest'
import {
  clearStoredSessionToken,
  getStoredSessionToken,
  PURCHASER_SESSION_KEY,
  setStoredSessionToken,
} from './auth-storage'

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

  test('keeps the purchaser token separate from the lunch token', () => {
    setStoredSessionToken('lunch-token')
    setStoredSessionToken('purchaser-token', PURCHASER_SESSION_KEY)

    expect(getStoredSessionToken()).toBe('lunch-token')
    expect(getStoredSessionToken(PURCHASER_SESSION_KEY)).toBe('purchaser-token')

    clearStoredSessionToken(PURCHASER_SESSION_KEY)
    expect(getStoredSessionToken(PURCHASER_SESSION_KEY)).toBeNull()
    expect(getStoredSessionToken()).toBe('lunch-token')
  })
})
