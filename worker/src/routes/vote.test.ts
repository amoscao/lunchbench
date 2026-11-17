import { describe, expect, test } from 'vitest'
import { voteRouter } from './vote'
import type { Bindings, LunchRow } from '../types'
import { createTestD1 } from '../../test/sqlite-d1'

function lunchRow(id: number, isVegan: number): LunchRow {
  return {
    id,
    name: `Lunch ${id}`,
    description: null,
    image_key: null,
    is_vegan: isVegan,
    is_legacy: 0,
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

function fakeDb(rows: LunchRow[] = ROWS): D1Database & { writeBatches: number } {
  return {
    writeBatches: 0,
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
          return { success: true, meta: { changes: 1 } }
        },
        async first() {
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
    async batch(this: { writeBatches: number }, statements: Array<{ sql: string; bound: unknown[] }>) {
      if (statements.every((statement) => statement.sql.includes('SELECT * FROM lunches'))) {
        return statements.map((statement) => {
          const [id] = statement.bound as [number]
          const row = rows.find((r) => r.id === id)
          return { results: row ? [row] : [] }
        })
      }
      this.writeBatches += 1
      return []
    },
  } as unknown as D1Database & { writeBatches: number }
}

function testEnv(rows: LunchRow[] = ROWS, db: D1Database = fakeDb(rows)): Bindings {
  return {
    DB: db,
    IMAGES: undefined,
    VOTE_PASSWORD: 'test-vote-token',
    ADMIN_MANAGER_PASSWORD: 'test-admin-password',
    SENTRY_DSN: '',
  }
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
    const env = testEnv()
    const res = await voteRouter.request('/', voteBody(1, 3), env)
    expect(res.status).toBe(400)
    const data = await res.json() as { code: string }
    expect(data.code).toBe('BAD_REQUEST')
  })

  test('rejects vote where left lunch does not exist', async () => {
    const env = testEnv()
    const res = await voteRouter.request('/', voteBody(99, 1), env)
    expect(res.status).toBe(404)
  })

  test('rejects vote where right lunch does not exist', async () => {
    const env = testEnv()
    const res = await voteRouter.request('/', voteBody(1, 99), env)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/vote legacy lunches (#286)', () => {
  const legacy = (id: number, isVegan = 0): LunchRow => ({ ...lunchRow(id, isVegan), is_legacy: 1 })

  test.each([
    ['left', [legacy(1), lunchRow(2, 0)]],
    ['right', [lunchRow(1, 0), legacy(2)]],
    ['both', [legacy(1), legacy(2)]],
  ] as const)('rejects a vote when the %s lunch is legacy, without writing', async (_side, rows) => {
    const db = fakeDb([...rows])
    const res = await voteRouter.request('/', voteBody(1, 2), testEnv([...rows], db))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Legacy lunches cannot be voted on', code: 'LEGACY_LUNCH' })
    expect(db.writeBatches).toBe(0)
  })

  test('a missing lunch is still 404, not 409', async () => {
    const rows = [legacy(1)]
    const res = await voteRouter.request('/', voteBody(1, 99), testEnv(rows))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/vote legacy lunches on real SQLite (#286)', () => {
  test('a legacy lunch on either side gets 409 and writes nothing', async () => {
    const { db, sqlite } = createTestD1()
    sqlite.prepare("INSERT INTO lunches (id, name, is_vegan, is_legacy) VALUES (1, 'Legacy', 0, 1), (2, 'Current', 0, 0)").run()
    const before = sqlite.prepare('SELECT * FROM lunches ORDER BY id').all()

    for (const [left, right] of [[1, 2], [2, 1]]) {
      const res = await voteRouter.request('/', voteBody(left, right), testEnv(ROWS, db))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'Legacy lunches cannot be voted on', code: 'LEGACY_LUNCH' })
    }

    expect(sqlite.prepare('SELECT * FROM lunches ORDER BY id').all()).toEqual(before)
    expect(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM votes').get()!.n)).toBe(0)
  })

  test('two current lunches still vote', async () => {
    const { db, sqlite } = createTestD1()
    sqlite.prepare("INSERT INTO lunches (id, name, is_vegan, is_legacy) VALUES (1, 'A', 0, 0), (2, 'B', 0, 0)").run()
    const res = await voteRouter.request('/', voteBody(1, 2), testEnv(ROWS, db))
    expect(res.status).toBe(200)
    expect(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM votes').get()!.n)).toBe(1)
  })
})
