import { describe, expect, test } from 'vitest'
import { sodaRouter } from './soda'
import type { Bindings } from '../types'

const SESSION = '550e8400-e29b-41d4-a716-446655440000'

type Write = { sql: string; values: unknown[] }

function fakeEnv(writes: Write[], activeSodaIds = [1, 2]): Bindings {
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          bound = values
          return statement
        },
        async first() {
          if (sql.includes('rate_limits')) return { count: 1, window_start: new Date().toISOString() }
          if (sql.includes('INSERT INTO soda_swipes') || sql.includes('INSERT INTO soda_reports')) {
            writes.push({ sql, values: bound })
            const sodaId = bound[2] as number
            return activeSodaIds.includes(sodaId) ? { soda_id: sodaId } : null
          }
          return null
        },
        async all() {
          return { results: [] }
        },
        async run() {
          return { success: true, meta: { changes: 1 } }
        },
      }
      return statement
    },
  } as unknown as D1Database
  return {
    DB: db,
    IMAGES: undefined,
    VOTE_PASSWORD: '',
    ADMIN_MANAGER_PASSWORD: '',
    SENTRY_DSN: '',
  }
}

function send(path: string, method: string, body: unknown, session: string | null = SESSION) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session) headers['X-Lunchbench-Session'] = session
  return { method, headers, body: JSON.stringify(body) }
}

describe('soda write routes', () => {
  test('records a swipe for the session', async () => {
    const writes: Write[] = []
    const res = await sodaRouter.request('/swipes', send('/swipes', 'PUT', { soda_id: 1, direction: 'right' }), fakeEnv(writes))

    expect(res.status).toBe(200)
    expect(writes[0].values).toEqual([SESSION, 'right', 1])
    expect(writes[0].sql).toContain('ON CONFLICT(session_key, soda_id) DO UPDATE')
  })

  test('rejects swipes without a valid session header', async () => {
    const writes: Write[] = []
    const missing = await sodaRouter.request('/swipes', send('/swipes', 'PUT', { soda_id: 1, direction: 'right' }, null), fakeEnv(writes))
    const malformed = await sodaRouter.request('/swipes', send('/swipes', 'PUT', { soda_id: 1, direction: 'right' }, 'nope'), fakeEnv(writes))

    expect(missing.status).toBe(400)
    expect(malformed.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  test('rejects bad swipe bodies', async () => {
    const writes: Write[] = []
    const e = fakeEnv(writes)
    for (const body of [{ soda_id: 1, direction: 'up' }, { soda_id: '1', direction: 'left' }, {}]) {
      expect((await sodaRouter.request('/swipes', send('/swipes', 'PUT', body), e)).status).toBe(400)
    }
    expect(writes).toHaveLength(0)
  })

  test('returns 404 for unknown or inactive sodas', async () => {
    const res = await sodaRouter.request('/swipes', send('/swipes', 'PUT', { soda_id: 99, direction: 'left' }), fakeEnv([]))
    expect(res.status).toBe(404)
  })

  test('records a report keyed by session, soda, and day', async () => {
    const writes: Write[] = []
    const res = await sodaRouter.request('/reports', send('/reports', 'POST', { soda_id: 2, verdict: 'hate' }), fakeEnv(writes))

    expect(res.status).toBe(200)
    expect(writes[0].values).toEqual([SESSION, 'hate', 2])
    expect(writes[0].sql).toContain('ON CONFLICT(session_key, soda_id, report_day) DO UPDATE')
  })

  test('rejects bad report verdicts', async () => {
    const res = await sodaRouter.request('/reports', send('/reports', 'POST', { soda_id: 2, verdict: 'meh' }), fakeEnv([]))
    expect(res.status).toBe(400)
  })
})
