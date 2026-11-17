import { describe, expect, test } from 'vitest'
import { adminRouter } from './admin'
import { matchupRouter } from './matchup'
import type { Bindings } from '../types'
import { createTestD1 } from '../../test/sqlite-d1'

// #308: DELETE /api/admin/lunches/:id on real SQLite with foreign keys on, as prod D1 has them.
const SESSION = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_SESSION = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function setup() {
  const { db, sqlite } = createTestD1()
  const env: Bindings = { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }
  const expires = new Date(Date.now() + 86_400_000).toISOString()
  sqlite.prepare('INSERT INTO admin_sessions (token, expires_at, role) VALUES (?, ?, ?)').run('admin-token', expires, 'admin')

  const insertLunch = sqlite.prepare('INSERT INTO lunches (id, name, is_vegan, is_legacy) VALUES (?, ?, 0, 0)')
  for (let id = 1; id <= 4; id++) insertLunch.run(id, `Lunch ${id}`)
  for (const session of [SESSION, OTHER_SESSION]) {
    sqlite.prepare('INSERT INTO matchup_sessions (session_key) VALUES (?)').run(session)
  }

  const presentation = sqlite.prepare(
    'INSERT INTO matchup_presentations (session_key, vegan_only, low_lunch_id, high_lunch_id) VALUES (?, ?, ?, ?)'
  )
  // Lunch 2 shown as the low side, the high side, in both modes and to two sessions.
  presentation.run(SESSION, 0, 1, 2)
  presentation.run(SESSION, 0, 2, 3)
  presentation.run(SESSION, 1, 2, 4)
  presentation.run(OTHER_SESSION, 0, 1, 2)
  // Pairs without lunch 2.
  presentation.run(SESSION, 0, 1, 3)
  presentation.run(OTHER_SESSION, 0, 3, 4)

  const token = sqlite.prepare(
    'INSERT INTO matchup_tokens (token, session_key, vegan_only, low_lunch_id, high_lunch_id) VALUES (?, ?, ?, ?, ?)'
  )
  token.run('token-1-2', SESSION, 0, 1, 2)
  token.run('token-2-4', OTHER_SESSION, 0, 2, 4)
  token.run('token-1-3', SESSION, 0, 1, 3)

  const vote = sqlite.prepare(
    `INSERT INTO votes (left_lunch_id, right_lunch_id, result, left_rating_before, right_rating_before,
       left_rating_after, right_rating_after)
     VALUES (?, ?, 'left_win', 1500, 1500, 1510, 1490)`
  )
  vote.run(2, 1)
  vote.run(3, 2)
  vote.run(1, 3)

  const count = (sql: string, ...values: unknown[]) => Number(sqlite.prepare(sql).get(...values)!.n)
  const deleteLunch = (id: number) =>
    adminRouter.request(`/lunches/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer admin-token' } }, env)

  return { sqlite, env, count, deleteLunch }
}

describe('admin lunch delete (#308)', () => {
  test('the harness enforces foreign keys, as prod D1 does', () => {
    const { sqlite } = setup()
    expect(sqlite.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  test('deletes a lunch that has been shown in matchups, with its votes, presentations and tokens', async () => {
    const { count, deleteLunch } = setup()

    const res = await deleteLunch(2)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })

    expect(count('SELECT COUNT(*) AS n FROM lunches WHERE id = 2')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM votes WHERE left_lunch_id = 2 OR right_lunch_id = 2')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM matchup_presentations WHERE low_lunch_id = 2 OR high_lunch_id = 2')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM matchup_tokens WHERE low_lunch_id = 2 OR high_lunch_id = 2')).toBe(0)

    // Nothing else goes: other lunches, their votes, pairs, tokens, and both sessions.
    expect(count('SELECT COUNT(*) AS n FROM lunches')).toBe(3)
    expect(count('SELECT COUNT(*) AS n FROM votes')).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM matchup_presentations')).toBe(2)
    expect(count('SELECT COUNT(*) AS n FROM matchup_tokens')).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM matchup_sessions')).toBe(2)
  })

  test('a matchup token issued before the delete is rejected, not a foreign key error', async () => {
    const { env, count, deleteLunch } = setup()
    expect((await deleteLunch(2)).status).toBe(200)

    const res = await matchupRouter.request('/seen', { method: 'POST', body: JSON.stringify({ token: 'token-1-2' }) }, env)
    expect(res.status).toBe(400)
    expect(count('SELECT COUNT(*) AS n FROM matchup_presentations WHERE low_lunch_id = 2 OR high_lunch_id = 2')).toBe(0)
  })

  test('a failed delete changes nothing (the batch is one transaction)', async () => {
    const { sqlite, count, deleteLunch } = setup()
    // Block the lunch row delete only, after the dependent rows are gone.
    sqlite.exec(`CREATE TRIGGER fk308_block BEFORE DELETE ON lunches BEGIN SELECT RAISE(ABORT, 'blocked'); END`)

    const res = await deleteLunch(2)
    expect(res.status).toBe(500)

    expect(count('SELECT COUNT(*) AS n FROM lunches')).toBe(4)
    expect(count('SELECT COUNT(*) AS n FROM votes')).toBe(3)
    expect(count('SELECT COUNT(*) AS n FROM matchup_presentations')).toBe(6)
    expect(count('SELECT COUNT(*) AS n FROM matchup_tokens')).toBe(3)
  })

  test('reset scores keeps lunches and matchup history and clears votes', async () => {
    const { count, env } = setup()
    const res = await adminRouter.request('/reset-scores', { method: 'POST', headers: { Authorization: 'Bearer admin-token' } }, env)
    expect(res.status).toBe(200)

    expect(count('SELECT COUNT(*) AS n FROM votes')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM lunches')).toBe(4)
    expect(count('SELECT COUNT(*) AS n FROM matchup_presentations')).toBe(6)
  })
})
