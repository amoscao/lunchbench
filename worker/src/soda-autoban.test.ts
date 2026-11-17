import { describe, expect, test } from 'vitest'
import { sodaRouter } from './routes/soda'
import { adminRouter } from './routes/admin'
import type { Bindings } from './types'
import { createTestD1 } from '../test/sqlite-d1'

// Issue #298: a drink with Hate reports from 5 distinct voters disappears everywhere.
const session = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Listed = { id?: number; soda_id?: number }

function setup() {
  const { db, sqlite } = createTestD1()
  const env: Bindings = { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }
  const expires = new Date(Date.now() + 86_400_000).toISOString()
  for (const role of ['admin', 'purchaser']) {
    sqlite.prepare('INSERT INTO admin_sessions (token, expires_at, role) VALUES (?, ?, ?)').run(`${role}-token`, expires, role)
  }
  // Coca-Cola Original: an active drink with seed barcodes.
  const target = Number(sqlite.prepare("SELECT id FROM sodas WHERE walmart_item_id = '12166733'").get()!.id)
  const json = (headers: Record<string, string>) => ({ 'Content-Type': 'application/json', ...headers })
  const report = (n: number, verdict: 'like' | 'hate', sodaId = target) =>
    sodaRouter.request('/reports', { method: 'POST', headers: json({ 'X-Lunchbench-Session': session(n) }), body: JSON.stringify({ soda_id: sodaId, verdict }) }, env)
  const swipe = (n: number) =>
    sodaRouter.request('/swipes', { method: 'PUT', headers: json({ 'X-Lunchbench-Session': session(n) }), body: JSON.stringify({ soda_id: target, direction: 'right' }) }, env)
  const get = async <T>(path: string, headers: Record<string, string> = {}) => (await sodaRouter.request(path, { headers }, env)).json() as Promise<T>
  const admin = (method: string, path: string, body?: unknown) =>
    adminRouter.request(path, { method, headers: json({ Authorization: 'Bearer admin-token' }), body: body === undefined ? undefined : JSON.stringify(body) }, env)

  const shownIn = async (): Promise<Record<string, boolean>> => {
    const has = (rows: Listed[]) => rows.some((row) => (row.id ?? row.soda_id) === target)
    await admin('POST', '/soda/regenerate')
    const order = await (await sodaRouter.request('/order/latest', { headers: { Authorization: 'Bearer purchaser-token' } }, env)).json() as { items: Listed[] }
    return {
      catalog: has((await get<{ sodas: Listed[] }>('/catalog')).sodas),
      feed: has((await get<{ sodas: Listed[] }>('/deck', { 'X-Lunchbench-Session': session(999) })).sodas),
      leaderboard: has((await get<{ sodas: Listed[] }>('/leaderboard')).sodas),
      barcodes: has((await get<{ barcodes: Listed[] }>('/barcodes')).barcodes),
      order: has(order.items),
    }
  }
  return { sqlite, env, target, report, swipe, get, admin, shownIn }
}

const everywhere = (value: boolean) => ({ catalog: value, feed: value, leaderboard: value, barcodes: value, order: value })

describe('auto-ban after 5 Hate reports', () => {
  test('4 hates keep the drink shown; the 5th hides it from catalog, feed, leaderboard, barcodes and order', async () => {
    const { report, target, sqlite, shownIn } = setup()
    // Make the drink a clear favorite first (20 liked reports), so the order list includes it.
    for (let n = 100; n < 120; n++) sqlite.prepare("INSERT INTO soda_reports (session_key, soda_id, verdict) VALUES (?, ?, 'like')").run(session(n), target)
    for (let n = 1; n <= 4; n++) expect((await report(n, 'hate')).status).toBe(200)
    expect(await shownIn()).toEqual(everywhere(true))

    expect((await report(5, 'hate')).status).toBe(200)
    expect(await shownIn()).toEqual(everywhere(false))
  })

  test('the same voter reporting Hate twice counts once', async () => {
    const { report, shownIn } = setup()
    for (let n = 1; n <= 4; n++) await report(n, 'hate')
    await report(4, 'hate')
    expect((await shownIn()).catalog).toBe(true)
  })

  test('a voter changing Hate to Like unbans the drink', async () => {
    const { report, sqlite, target, shownIn } = setup()
    for (let n = 100; n < 120; n++) sqlite.prepare("INSERT INTO soda_reports (session_key, soda_id, verdict) VALUES (?, ?, 'like')").run(session(n), target)
    for (let n = 1; n <= 4; n++) await report(n, 'hate')
    // Before the ban, a change of mind goes through the API.
    expect((await report(4, 'like')).status).toBe(200)
    await report(5, 'hate')
    expect((await shownIn()).catalog).toBe(true)
    await report(6, 'hate')
    expect(await shownIn()).toEqual(everywhere(false))
    // The ban is computed, not stored: once a report changes, the drink is back.
    sqlite.prepare("UPDATE soda_reports SET verdict = 'like' WHERE session_key = ? AND soda_id = ?").run(session(1), target)
    expect(await shownIn()).toEqual(everywhere(true))
  })

  test('reports, swipes and admin barcode mappings for a banned drink get 409 SODA_BANNED; history is kept', async () => {
    const { report, swipe, admin, target, sqlite } = setup()
    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    const rejected = [await report(7, 'like'), await report(1, 'like'), await swipe(8)]
    for (const res of rejected) {
      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toMatchObject({ code: 'SODA_BANNED' })
    }
    const mapping = await admin('POST', '/soda/barcodes', { code: '012345678905', soda_id: target })
    expect(mapping.status).toBe(409)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_reports WHERE soda_id = ?').get(target)!.n).toBe(5)
  })

  test('a scanned code of a banned drink is no longer served, so it is logged as unknown', async () => {
    const { report, sqlite, target, get, env } = setup()
    const code = String(sqlite.prepare('SELECT code FROM soda_barcodes WHERE soda_id = ? LIMIT 1').get(target)!.code)
    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    const barcodes = (await get<{ barcodes: Array<{ code: string }> }>('/barcodes')).barcodes
    expect(barcodes.some((row) => row.code === code)).toBe(false)
    const res = await sodaRouter.request('/unknown-scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': session(50) },
      body: JSON.stringify({ barcode: code, format: 'ean_13' }),
    }, env)
    expect(res.status).toBeLessThan(300)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_unknown_scans WHERE code = ?').get(code)!.n).toBe(1)
  })

  test('the admin "Banned drinks" list shows name, hate count and like count', async () => {
    const { report, admin, target } = setup()
    for (let n = 1; n <= 4; n++) await report(n, 'hate')
    expect((await (await admin('GET', '/soda/banned')).json() as { banned: unknown[] }).banned).toEqual([])
    await report(10, 'like')
    await report(11, 'like')
    await report(5, 'hate')
    const res = await admin('GET', '/soda/banned')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ banned: [{ id: target, name: 'Coca-Cola Original', hates: 5, likes: 2 }] })
    const purchaser = await adminRouter.request('/soda/banned', { headers: { Authorization: 'Bearer purchaser-token' } }, setup().env)
    expect(purchaser.status).toBe(401)
  })
})
