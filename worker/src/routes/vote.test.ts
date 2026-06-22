import { describe, expect, test } from 'vitest'
import { voteRouter } from './vote'
import type { Bindings, LunchRow } from '../types'

function lunchRow(id: number, isVegan: number): LunchRow {
  return {
    id,
    name: `Lunch ${id}`,
    description: null,
    image_key: null,
    is_vegan: isVegan,
    rating: 1500,
    glicko_rd: 100,
    glicko_volatility: 0.06,
    conservative_rating: 1300,
    wins: 0,
    losses: 0,
    ties: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

const ROWS: LunchRow[] = [
  lunchRow(1, 0),
  lunchRow(2, 0),
  lunchRow(3, 1),
]

function fakeDb(rows: LunchRow[] = ROWS): D1Database {
  const rateLimits = new Map<string, { count: number; window_start: string }>()

  return {
    prepare(sql: string) {
      let bound: unknown[] = []
      const self = {
        sql,
        get bound() {
          return bound
        },
        bind(...args: unknown[]) {
          bound = args
          return self
        },
        async run() {
          if (sql.includes('rate_limits')) {
            const [key, action, windowStart] = bound as [string, string, string]
            const rowKey = `${key}:${action}`
            const existing = rateLimits.get(rowKey)
            rateLimits.set(rowKey, {
              count: existing?.window_start === windowStart ? existing.count + 1 : 1,
              window_start: windowStart,
            })
          }
          return { success: true, meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('rate_limits') || sql.includes('cooldown')) {
            const [key, action] = bound as [string, string]
            return rateLimits.get(`${key}:${action}`) ?? null
          }
          if (sql.includes('SELECT is_vegan FROM lunches')) {
            const [id] = bound as [number]
            const row = rows.find((r) => r.id === id)
            return row ? { is_vegan: row.is_vegan } : null
          }
          return null
        },
        async all() {
          if (sql.includes('admin_sessions')) return { results: [] }
          return { results: [] }
        },
        async batch() {
          return []
        },
      }
      return self
    },
    batch: async (statements: Array<{ sql: string; bound: unknown[] }>) => {
      if (statements.every((statement) => statement.sql.includes('SELECT * FROM lunches'))) {
        return statements.map((statement) => {
          const [id] = statement.bound as [number]
          const row = rows.find((r) => r.id === id)
          return { results: row ? [row] : [] }
        })
      }
      return []
    },
  } as unknown as D1Database
}

const env: Bindings = {
  DB: fakeDb(),
  IMAGES: undefined,
  VOTE_PASSWORD: 'test-vote-token',
  ADMIN_MANAGER_PASSWORD: 'test-admin-password',
  SENTRY_DSN: '',
}

function voteBody(leftId: number, rightId: number) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ left_lunch_id: leftId, right_lunch_id: rightId, result: 'left_win' }),
  }
}

describe('POST /api/vote vegan category enforcement', () => {
  test('rejects vote between vegan and non-vegan lunch', async () => {
    const res = await voteRouter.request('/', voteBody(1, 3), env)
    expect(res.status).toBe(400)
    const data = await res.json() as { code: string }
    expect(data.code).toBe('BAD_REQUEST')
  })

  test('rejects vote where left lunch does not exist', async () => {
    const res = await voteRouter.request('/', voteBody(99, 1), env)
    expect(res.status).toBe(404)
  })

  test('rejects vote where right lunch does not exist', async () => {
    const res = await voteRouter.request('/', voteBody(1, 99), env)
    expect(res.status).toBe(404)
  })
})
