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

  test('records one report per session and soda, latest wins', async () => {
    const writes: Write[] = []
    const res = await sodaRouter.request('/reports', send('/reports', 'POST', { soda_id: 2, verdict: 'hate' }), fakeEnv(writes))

    expect(res.status).toBe(200)
    expect(writes[0].values).toEqual([SESSION, 'hate', 2])
    expect(writes[0].sql).toContain('INSERT INTO soda_reports (session_key, soda_id, verdict, reported_at)')
    expect(writes[0].sql).toContain('ON CONFLICT(session_key, soda_id) DO UPDATE')
  })

  test('rejects bad report verdicts', async () => {
    const res = await sodaRouter.request('/reports', send('/reports', 'POST', { soda_id: 2, verdict: 'meh' }), fakeEnv([]))
    expect(res.status).toBe(400)
  })
})

describe('order list snapshots', () => {
  test('drops legacy backup rows from snapshots written before backups were removed', async () => {
    const legacyItems = [
      { rank: 1, slot: 'top', soda_id: 1, brand: 'A', flavor: 'One', type: 'soda', image_key: null, right_swipes: 0, left_swipes: 0, has_data: false },
      { rank: 2, slot: 'trial', soda_id: 2, brand: 'B', flavor: 'Two', type: 'seltzer', image_key: null, right_swipes: 0, left_swipes: 0, has_data: false },
      { rank: 3, slot: 'backup', soda_id: 3, brand: 'C', flavor: 'Three', type: 'soda', image_key: null, right_swipes: 0, left_swipes: 0, has_data: false },
    ]
    const row = { week_start: '2026-11-16', generated_at: '2026-11-16T12:00:00Z', items_json: JSON.stringify(legacyItems), params_json: '{}' }
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() {
            return statement
          },
          async all() {
            if (sql.includes('FROM admin_sessions')) {
              return { results: [{ token: 'purchaser-token', role: 'purchaser', expires_at: '2999-01-01T00:00:00Z' }] }
            }
            return { results: [] }
          },
          async first() {
            if (sql.includes('FROM soda_buy_lists WHERE week_start = ?')) return { week_start: row.week_start }
            if (sql.includes('FROM soda_buy_lists')) return row
            return null
          },
          async run() {
            return { success: true, meta: { changes: 1 } }
          },
        }
        return statement
      },
    } as unknown as D1Database
    const env: Bindings = { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }

    const res = await sodaRouter.request('/order/latest', { headers: { Authorization: 'Bearer purchaser-token' } }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { items: { slot: string; rank: number }[] }
    expect(body.items.map((item) => [item.slot, item.rank])).toEqual([['top', 1], ['trial', 2]])
  })
})

describe('swipe feed route', () => {
  function stat(id: number, overrides: Record<string, unknown> = {}) {
    return {
      id, brand: `Brand ${id}`, flavor: 'Plain', type: 'soda', image_key: null,
      right_swipes: 0, left_swipes: 0, likes: 0, hates: 0, reporters: 0, ...overrides,
    }
  }

  function deckEnv(stats: unknown[], swipedIds: number[]): Bindings {
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() {
            return statement
          },
          async all() {
            if (sql.includes('FROM soda_swipes WHERE session_key')) return { results: swipedIds.map((soda_id) => ({ soda_id })) }
            if (sql.includes('FROM sodas s')) return { results: stats }
            return { results: [] }
          },
          async first() {
            return null
          },
          async run() {
            return { success: true, meta: { changes: 1 } }
          },
        }
        return statement
      },
    } as unknown as D1Database
    return { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }
  }

  async function deckIds(env: Bindings, session: string | null): Promise<number[]> {
    const headers: Record<string, string> = session ? { 'X-Lunchbench-Session': session } : {}
    const res = await sodaRouter.request('/deck', { headers }, env)
    expect(res.status).toBe(200)
    return ((await res.json()) as { sodas: { id: number }[] }).sodas.map((s) => s.id)
  }

  test('scores drinks before ordering: a well-liked drink leads most voters\' feeds', async () => {
    const stats = [
      stat(1, { likes: 4, reporters: 4 }),
      ...Array.from({ length: 19 }, (_, i) => stat(i + 2)),
    ]
    const env = deckEnv(stats, [])
    let firstInTop3 = 0
    const voters = 200
    for (let i = 0; i < voters; i++) {
      const session = `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
      if ((await deckIds(env, session)).slice(0, 3).includes(1)) firstInTop3 += 1
    }
    // Uniform would put it in the top 3 for 15% of voters.
    expect(firstInTop3 / voters).toBeGreaterThan(0.4)
  })

  test('leaves out drinks this voter swiped', async () => {
    const env = deckEnv([stat(1), stat(2), stat(3)], [2])
    expect((await deckIds(env, SESSION)).sort()).toEqual([1, 3])
  })

  test('without a session header returns every drink', async () => {
    const env = deckEnv([stat(1), stat(2), stat(3)], [])
    expect((await deckIds(env, null)).sort()).toEqual([1, 2, 3])
  })
})

