import { describe, expect, test } from 'vitest'
import { lunchesRouter } from './routes/lunches'
import type { Bindings, LunchRow } from './types'

function lunchRow(id: number, name: string, isVegan: number, conservativeRating: number): LunchRow {
  return {
    id,
    name,
    description: null,
    image_key: null,
    is_vegan: isVegan,
    rating: 1500,
    glicko_rd: 100,
    glicko_volatility: 0.06,
    conservative_rating: conservativeRating,
    wins: 0,
    losses: 0,
    ties: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function fakeDb(): D1Database {
  const rows = [
    lunchRow(1, 'Non-vegan A', 0, 1400),
    lunchRow(2, 'Vegan A', 1, 1600),
    lunchRow(3, 'Non-vegan B', 0, 1500),
    lunchRow(4, 'Vegan B', 1, 1300),
  ]
  const rateLimits = new Map<string, { count: number; window_start: string }>()

  return {
    prepare(sql: string) {
      let bound: unknown[] = []
      return {
        bind(...args: unknown[]) {
          bound = args
          return this
        },
        async run() {
          const [key, action, windowStart] = bound as [string, string, string]
          const rowKey = `${key}:${action}`
          const existing = rateLimits.get(rowKey)
          rateLimits.set(rowKey, {
            count: existing?.window_start === windowStart ? existing.count + 1 : 1,
            window_start: windowStart,
          })
        },
        async first() {
          const [key, action] = bound as [string, string]
          return rateLimits.get(`${key}:${action}`) ?? null
        },
        async all() {
          const veganFilter = sql.includes('WHERE is_vegan = 1') ? 1 : 0
          return {
            results: rows
              .filter((row) => row.is_vegan === veganFilter)
              .sort((a, b) => b.conservative_rating - a.conservative_rating || a.name.localeCompare(b.name) || a.id - b.id),
          }
        },
      }
    },
  } as unknown as D1Database
}

const env: Bindings = {
  DB: fakeDb(),
  IMAGES: undefined,
  VOTE_PASSWORD: 'test-admin-token',
  ADMIN_MANAGER_PASSWORD: 'test-admin-password',
  SENTRY_DSN: '',
}

describe('lunches leaderboard', () => {
  test('defaults to non-vegan lunches only', async () => {
    const res = await lunchesRouter.request('/leaderboard', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.lunches.map((lunch: { name: string }) => lunch.name)).toEqual(['Non-vegan B', 'Non-vegan A'])
    expect(data.lunches.every((lunch: { is_vegan: number }) => lunch.is_vegan === 0)).toBe(true)
  })

  test('treats vegan=false as the non-vegan leaderboard', async () => {
    const res = await lunchesRouter.request('/leaderboard?vegan=false', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.lunches.map((lunch: { name: string }) => lunch.name)).toEqual(['Non-vegan B', 'Non-vegan A'])
    expect(data.lunches.every((lunch: { is_vegan: number }) => lunch.is_vegan === 0)).toBe(true)
  })

  test('returns vegan lunches only when requested', async () => {
    const res = await lunchesRouter.request('/leaderboard?vegan=true', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.lunches.map((lunch: { name: string }) => lunch.name)).toEqual(['Vegan A', 'Vegan B'])
    expect(data.lunches.every((lunch: { is_vegan: number }) => lunch.is_vegan === 1)).toBe(true)
  })
})
