import { describe, expect, test } from 'vitest'
import { MATCHUP_HISTORY_LIMIT, matchupRouter } from './matchup'
import type { Bindings } from '../types'
import { createTestD1 } from '../../test/sqlite-d1'

// #249: GET /api/matchup reads only the newest MATCHUP_HISTORY_LIMIT presentations of a session.
// Real SQLite with every migration, so the ORDER BY / LIMIT and the /seen upsert run as written.
const SESSION = '550e8400-e29b-41d4-a716-446655440000'

function setup(lunchCount: number) {
  const { db, sqlite } = createTestD1()
  const env: Bindings = { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }
  const insertLunch = sqlite.prepare('INSERT INTO lunches (id, name, is_vegan, is_legacy) VALUES (?, ?, 0, 0)')
  for (let id = 1; id <= lunchCount; id++) insertLunch.run(id, `Lunch ${id}`)
  sqlite.prepare('INSERT INTO matchup_sessions (session_key) VALUES (?)').run(SESSION)

  // Every pair already presented, oldest first, one second apart, in the seconds-only format that
  // datetime('now') wrote before this change.
  const insertPresentation = sqlite.prepare(
    `INSERT INTO matchup_presentations (session_key, vegan_only, low_lunch_id, high_lunch_id, presented_at)
     VALUES (?, 0, ?, ?, datetime('2026-01-01', '+' || ? || ' seconds'))`
  )
  const pairsOldestFirst: string[] = []
  for (let low = 1; low <= lunchCount; low++) {
    for (let high = low + 1; high <= lunchCount; high++) {
      insertPresentation.run(SESSION, low, high, pairsOldestFirst.length)
      pairsOldestFirst.push(`${low}:${high}`)
    }
  }

  async function getMatchup() {
    const res = await matchupRouter.request('/', { headers: { 'X-Lunchbench-Session': SESSION } }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; matchup_token?: string; left?: { id: number }; right?: { id: number } }
    const pair = body.left && body.right
      ? [body.left.id, body.right.id].sort((a, b) => a - b).join(':')
      : null
    return { ...body, pair }
  }

  async function acknowledge(token: string) {
    const res = await matchupRouter.request('/seen', { method: 'POST', body: JSON.stringify({ token }) }, env)
    expect(res.status).toBe(200)
  }

  return { sqlite, pairsOldestFirst, getMatchup, acknowledge }
}

describe('matchup history cap (#249)', () => {
  test('the cap is 2000 rows, the client seen-pairs size', () => {
    expect(MATCHUP_HISTORY_LIMIT).toBe(2000)
  })

  test('reports exhausted when every pair fits in the window', async () => {
    // 63 lunches = 1953 pairs <= 2000.
    const { getMatchup } = setup(63)
    expect((await getMatchup()).status).toBe('exhausted')
  })

  test('past the cap, serves only pairs that fell out of the window and never reports exhausted', async () => {
    // 64 lunches = 2016 pairs: the 16 oldest are outside the 2000-row window.
    const { pairsOldestFirst, getMatchup } = setup(64)
    const outside = new Set(pairsOldestFirst.slice(0, pairsOldestFirst.length - MATCHUP_HISTORY_LIMIT))
    expect(outside.size).toBe(16)

    for (let i = 0; i < 10; i++) {
      const body = await getMatchup()
      expect(body.status).toBe('ok')
      expect(outside.has(body.pair!)).toBe(true)
    }
  })

  test('acknowledging a re-served pair moves it back into the window, so the session cycles', async () => {
    const { sqlite, pairsOldestFirst, getMatchup, acknowledge } = setup(64)
    const outsideCount = pairsOldestFirst.length - MATCHUP_HISTORY_LIMIT
    const served = new Set<string>()

    // Each ack pushes the next-oldest pair out, so these rounds serve distinct pairs.
    for (let i = 0; i < outsideCount; i++) {
      const body = await getMatchup()
      expect(body.status).toBe('ok')
      expect(served.has(body.pair!)).toBe(false)
      served.add(body.pair!)
      await acknowledge(body.matchup_token!)
    }

    // Still one row per pair, and the refreshed rows (millisecond format) sort as the newest.
    expect(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM matchup_presentations').get()!.n)).toBe(pairsOldestFirst.length)
    const newest = sqlite.prepare(
      `SELECT low_lunch_id || ':' || high_lunch_id AS pair FROM matchup_presentations
       ORDER BY presented_at DESC, rowid DESC LIMIT ?`
    ).all(outsideCount).map((row) => String(row.pair))
    expect(new Set(newest)).toEqual(served)
  })
})
