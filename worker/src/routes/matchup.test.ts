import { describe, expect, test } from 'vitest'
import { matchupRouter, parseSessionKey } from './matchup'
import type { Bindings, LunchRow } from '../types'

const SESSION = '550e8400-e29b-41d4-a716-446655440000'

function lunchRow(
  id: number,
  isVegan: number,
  name = `Lunch ${id}`,
  rating = 1500 + id
): LunchRow {
  return {
    id,
    name,
    description: null,
    image_key: null,
    is_vegan: isVegan,
    rating,
    glicko_rd: 100,
    glicko_volatility: 0.06,
    conservative_rating: rating - 200,
    wins: 0,
    losses: 0,
    ties: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

const ALL_ROWS = [
  lunchRow(1, 0, 'Non-vegan A', 1500),
  lunchRow(2, 0, 'Non-vegan B', 1510),
  lunchRow(3, 1, 'Vegan A', 1600),
  lunchRow(4, 1, 'Vegan B', 1620),
]

type Presentation = {
  session_key: string
  vegan_only: number
  low_lunch_id: number
  high_lunch_id: number
}

type TokenRow = Presentation & {
  token: string
}

function fakeDb(rows: LunchRow[] = ALL_ROWS): D1Database & {
  presentations: Presentation[]
  sessions: Set<string>
  tokens: Map<string, TokenRow>
} {
  const rateLimits = new Map<string, { count: number; window_start: string }>()
  const db = {
    presentations: [] as Presentation[],
    sessions: new Set<string>(),
    tokens: new Map<string, TokenRow>(),
    prepare(sql: string) {
      let bound: unknown[] = []
      const statement = {
        bind(...args: unknown[]) {
          bound = args
          return statement
        },
        async run() {
          if (sql.includes('rate_limits') && sql.includes('INSERT')) {
            const [key, action, windowStart] = bound as [string, string, string]
            const rowKey = `${key}:${action}`
            const existing = rateLimits.get(rowKey)
            rateLimits.set(rowKey, {
              count: existing?.window_start === windowStart ? existing.count + 1 : 1,
              window_start: windowStart,
            })
          } else if (sql.includes('INSERT INTO matchup_sessions')) {
            db.sessions.add(bound[0] as string)
          } else if (sql.includes('INSERT INTO matchup_tokens')) {
            const [token, sessionKey, veganOnly, lowLunchId, highLunchId] = bound as [string, string, number, number, number]
            db.tokens.set(token, {
              token,
              session_key: sessionKey,
              vegan_only: veganOnly,
              low_lunch_id: lowLunchId,
              high_lunch_id: highLunchId,
            })
          } else if (sql.includes('INSERT OR IGNORE INTO matchup_presentations')) {
            const [sessionKey, veganOnly, lowLunchId, highLunchId] = bound as [string, number, number, number]
            const exists = db.presentations.some((row) =>
              row.session_key === sessionKey &&
              row.vegan_only === veganOnly &&
              row.low_lunch_id === lowLunchId &&
              row.high_lunch_id === highLunchId
            )
            if (!exists) {
              db.presentations.push({
                session_key: sessionKey,
                vegan_only: veganOnly,
                low_lunch_id: lowLunchId,
                high_lunch_id: highLunchId,
              })
            }
          }
          return { success: true, meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('rate_limits')) {
            const [key, action] = bound as [string, string]
            return rateLimits.get(`${key}:${action}`) ?? null
          }
          if (sql.includes('FROM matchup_tokens')) return db.tokens.get(bound[0] as string) ?? null
          if (sql.includes('COUNT(*)')) return { rank: 1 }
          return null
        },
        async all() {
          if (sql.includes('FROM lunches WHERE is_vegan = 1')) {
            return { results: rows.filter((row) => row.is_vegan === 1) }
          }
          if (sql.includes('FROM lunches WHERE is_vegan = 0')) {
            return { results: rows.filter((row) => row.is_vegan === 0) }
          }
          if (sql.includes('FROM votes')) return { results: [] }
          if (sql.includes('FROM matchup_presentations')) {
            const [sessionKey, veganOnly] = bound as [string, number]
            return {
              results: db.presentations.filter((row) =>
                row.session_key === sessionKey && row.vegan_only === veganOnly
              ),
            }
          }
          return { results: rows }
        },
      }
      return statement
    },
  }
  return db as unknown as D1Database & {
    presentations: Presentation[]
    sessions: Set<string>
    tokens: Map<string, TokenRow>
  }
}

function env(db: D1Database): Bindings {
  return {
    DB: db,
    IMAGES: undefined,
    VOTE_PASSWORD: 'test-lunch-password',
    ADMIN_MANAGER_PASSWORD: 'test-admin-password',
    SENTRY_DSN: '',
  }
}

describe('parseSessionKey', () => {
  test('accepts UUIDs and ignores malformed values', () => {
    expect(parseSessionKey(SESSION)).toBe(SESSION)
    expect(parseSessionKey(` ${SESSION} `)).toBe(SESSION)
    expect(parseSessionKey('not-a-uuid')).toBeNull()
    expect(parseSessionKey(null)).toBeNull()
  })
})

describe('GET /api/matchup vegan filtering', () => {
  test('default returns only non-vegan lunches', async () => {
    const db = fakeDb()
    const res = await matchupRouter.request('/', { method: 'GET' }, env(db))
    expect(res.status).toBe(200)
    const data = await res.json() as { left: LunchRow; right: LunchRow }
    expect(data.left.is_vegan).toBe(0)
    expect(data.right.is_vegan).toBe(0)
  })

  test('vegan=true returns only vegan lunches', async () => {
    const db = fakeDb()
    const res = await matchupRouter.request('/?vegan=true', { method: 'GET' }, env(db))
    expect(res.status).toBe(200)
    const data = await res.json() as { left: LunchRow; right: LunchRow }
    expect(data.left.is_vegan).toBe(1)
    expect(data.right.is_vegan).toBe(1)
  })

  test('returns 204 when fewer than 2 lunches in the requested group', async () => {
    const singleVeganDb = fakeDb([
      lunchRow(1, 0, 'Non-vegan A', 1500),
      lunchRow(2, 0, 'Non-vegan B', 1510),
      lunchRow(3, 1, 'Only Vegan', 1600),
    ])
    const res = await matchupRouter.request('/?vegan=true', { method: 'GET' }, env(singleVeganDb))
    expect(res.status).toBe(204)
  })
})

describe('matchup route session tracking', () => {
  test('GET returns a token without recording a presentation, then POST /seen records idempotently', async () => {
    const db = fakeDb([lunchRow(1, 0), lunchRow(2, 0)])
    const first = await matchupRouter.request('/', {
      headers: { 'X-Lunchbench-Session': SESSION },
    }, env(db))

    expect(first.status).toBe(200)
    const body = await first.json() as { status: string; matchup_token: string }
    expect(body.status).toBe('ok')
    expect(body.matchup_token).toMatch(/[0-9a-f-]{36}/)
    expect(db.presentations).toHaveLength(0)

    const ack = await matchupRouter.request('/seen', {
      method: 'POST',
      body: JSON.stringify({ token: body.matchup_token }),
    }, env(db))
    const duplicateAck = await matchupRouter.request('/seen', {
      method: 'POST',
      body: JSON.stringify({ token: body.matchup_token }),
    }, env(db))

    expect(ack.status).toBe(200)
    expect(duplicateAck.status).toBe(200)
    expect(db.presentations).toEqual([
      { session_key: SESSION, vegan_only: 0, low_lunch_id: 1, high_lunch_id: 2 },
    ])

    const exhausted = await matchupRouter.request('/', {
      headers: { 'X-Lunchbench-Session': SESSION },
    }, env(db))
    expect(exhausted.status).toBe(200)
    expect(await exhausted.json()).toEqual({ status: 'exhausted' })
  })

  test('scopes exhaustion by vegan mode', async () => {
    const db = fakeDb([lunchRow(1, 0), lunchRow(2, 0), lunchRow(3, 1), lunchRow(4, 1)])
    db.presentations.push({ session_key: SESSION, vegan_only: 0, low_lunch_id: 1, high_lunch_id: 2 })

    const nonVegan = await matchupRouter.request('/', {
      headers: { 'X-Lunchbench-Session': SESSION },
    }, env(db))
    const vegan = await matchupRouter.request('/?vegan=true', {
      headers: { 'X-Lunchbench-Session': SESSION },
    }, env(db))

    expect(await nonVegan.json()).toEqual({ status: 'exhausted' })
    expect((await vegan.json() as { status: string }).status).toBe('ok')
  })

  test('ignores malformed session headers for deterministic tracking', async () => {
    const db = fakeDb([lunchRow(1, 0), lunchRow(2, 0)])
    const res = await matchupRouter.request('/', {
      headers: { 'X-Lunchbench-Session': 'bad-session' },
    }, env(db))

    expect(res.status).toBe(200)
    expect(db.sessions.has('bad-session')).toBe(false)
    expect(db.tokens.size).toBe(1)
  })

  test('rejects missing or unknown seen tokens', async () => {
    const db = fakeDb([lunchRow(1, 0), lunchRow(2, 0)])
    const missing = await matchupRouter.request('/seen', {
      method: 'POST',
      body: JSON.stringify({}),
    }, env(db))
    const unknown = await matchupRouter.request('/seen', {
      method: 'POST',
      body: JSON.stringify({ token: 'unknown' }),
    }, env(db))

    expect(missing.status).toBe(400)
    expect(unknown.status).toBe(400)
  })
})
