import { describe, expect, test } from 'vitest'
import { validateAdminSession } from './helpers'
import { adminRouter } from './routes/admin'
import { sodaRouter } from './routes/soda'
import type { Bindings } from './types'

type Session = { token: string; role: string; expires_at: string }

const FUTURE = '2999-01-01T00:00:00.000Z'

function fakeDb(sessions: Session[], inserted: Session[] = []): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          bound = values
          return statement
        },
        async all() {
          if (sql.includes('FROM admin_sessions')) return { results: sessions }
          return { results: [] }
        },
        async first() {
          return null
        },
        async run() {
          if (sql.includes('INSERT OR REPLACE INTO admin_sessions')) {
            inserted.push({ token: bound[0] as string, expires_at: bound[1] as string, role: bound[2] as string })
          }
          return { success: true, meta: { changes: 1 } }
        },
      }
      return statement
    },
  } as unknown as D1Database
}

function env(db: D1Database): Bindings {
  return {
    DB: db,
    IMAGES: undefined,
    VOTE_PASSWORD: 'lunch-password',
    ADMIN_MANAGER_PASSWORD: 'admin-password',
    PURCHASER_PASSWORD: 'purchaser-password',
    SENTRY_DSN: '',
  }
}

function bearer(token: string): Request {
  return new Request('http://test/', { headers: { Authorization: `Bearer ${token}` } })
}

const SESSIONS: Session[] = [
  { token: 'admin-token', role: 'admin', expires_at: FUTURE },
  { token: 'lunch-token', role: 'lunch', expires_at: FUTURE },
  { token: 'purchaser-token', role: 'purchaser', expires_at: FUTURE },
  { token: 'expired-purchaser', role: 'purchaser', expires_at: '2000-01-01T00:00:00.000Z' },
]

describe('purchaser session role', () => {
  test('purchaser routes accept admin and purchaser sessions only', async () => {
    const db = fakeDb(SESSIONS)
    expect(await validateAdminSession(bearer('purchaser-token'), db, 'purchaser')).toBe(true)
    expect(await validateAdminSession(bearer('admin-token'), db, 'purchaser')).toBe(true)
    expect(await validateAdminSession(bearer('lunch-token'), db, 'purchaser')).toBe(false)
    expect(await validateAdminSession(bearer('expired-purchaser'), db, 'purchaser')).toBe(false)
  })

  test('purchaser sessions get no admin or lunch powers', async () => {
    const db = fakeDb(SESSIONS)
    expect(await validateAdminSession(bearer('purchaser-token'), db, 'admin')).toBe(false)
    expect(await validateAdminSession(bearer('purchaser-token'), db, 'lunch')).toBe(false)
  })

  test('verify mints a purchaser session for PURCHASER_PASSWORD', async () => {
    const inserted: Session[] = []
    const res = await adminRouter.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'purchaser-password' }),
    }, env(fakeDb([], inserted)))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ role: 'purchaser' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].role).toBe('purchaser')
  })

  test('admin password still mints an admin session', async () => {
    const inserted: Session[] = []
    const res = await adminRouter.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' }),
    }, env(fakeDb([], inserted)))

    expect(res.status).toBe(200)
    expect(inserted[0].role).toBe('admin')
  })

  test('purchaser cannot use admin routes or regenerate the order list', async () => {
    const e = env(fakeDb(SESSIONS))
    const headers = { Authorization: 'Bearer purchaser-token' }

    expect((await adminRouter.request('/lunches', { headers }, e)).status).toBe(401)
    expect((await adminRouter.request('/soda/regenerate', { method: 'POST', headers }, e)).status).toBe(401)
  })

  test('order list rejects lunch sessions and anonymous requests', async () => {
    const e = env(fakeDb(SESSIONS))

    expect((await sodaRouter.request('/order/latest', {}, e)).status).toBe(401)
    expect((await sodaRouter.request('/order/latest', {
      headers: { Authorization: 'Bearer lunch-token' },
    }, e)).status).toBe(401)
  })
})
