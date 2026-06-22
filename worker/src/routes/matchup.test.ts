import { describe, expect, test } from 'vitest'
import { matchupRouter } from './matchup'
import type { Bindings, LunchRow } from '../types'

function lunchRow(id: number, name: string, isVegan: number, rating = 1500): LunchRow {
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
  lunchRow(1, 'Non-vegan A', 0, 1500),
  lunchRow(2, 'Non-vegan B', 0, 1510),
  lunchRow(3, 'Vegan A', 1, 1600),
  lunchRow(4, 'Vegan B', 1, 1620),
]

function fakeDb(rows: LunchRow[] = ALL_ROWS): D1Database {
  const rateLimits = new Map<string, { count: number; window_start: string }>()

  return {
    prepare(sql: string) {
      let bound: unknown[] = []
      const self = {
        bind(...args: unknown[]) {
          bound = args
          return self
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
          }
          return { success: true, meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('rate_limits')) {
            const [key, action] = bound as [string, string]
            return rateLimits.get(`${key}:${action}`) ?? null
          }
          // rank queries
          if (sql.includes('COUNT(*)')) {
            return { rank: 1 }
          }
          return null
        },
        async all() {
          if (sql.includes('FROM lunches WHERE is_vegan = 1')) {
            return { results: rows.filter((r) => r.is_vegan === 1) }
          }
          if (sql.includes('FROM lunches WHERE is_vegan = 0')) {
            return { results: rows.filter((r) => r.is_vegan === 0) }
          }
          // recent votes
          if (sql.includes('FROM votes')) {
            return { results: [] }
          }
          return { results: rows }
        },
      }
      return self
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

describe('GET /api/matchup vegan filtering', () => {
  test('default returns only non-vegan lunches', async () => {
    const res = await matchupRouter.request('/', { method: 'GET' }, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { left: LunchRow; right: LunchRow }
    expect(data.left.is_vegan).toBe(0)
    expect(data.right.is_vegan).toBe(0)
  })

  test('vegan=true returns only vegan lunches', async () => {
    const res = await matchupRouter.request('/?vegan=true', { method: 'GET' }, env)
    expect(res.status).toBe(200)
    const data = await res.json() as { left: LunchRow; right: LunchRow }
    expect(data.left.is_vegan).toBe(1)
    expect(data.right.is_vegan).toBe(1)
  })

  test('returns 204 when fewer than 2 lunches in the requested group', async () => {
    const singleVeganDb = fakeDb([
      lunchRow(1, 'Non-vegan A', 0, 1500),
      lunchRow(2, 'Non-vegan B', 0, 1510),
      lunchRow(3, 'Only Vegan', 1, 1600),
    ])
    const res = await matchupRouter.request('/?vegan=true', { method: 'GET' }, {
      ...env,
      DB: singleVeganDb,
    })
    expect(res.status).toBe(204)
  })
})
