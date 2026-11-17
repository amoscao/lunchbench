import { describe, expect, test } from 'vitest'
import { sodaRouter } from './routes/soda'
import { adminRouter } from './routes/admin'
import type { Bindings } from './types'
import { createTestD1 } from '../test/sqlite-d1'
import { loadScoringStats } from './soda-data'
import { scoreDrinks } from './soda-score'
import { deckWeight } from './soda-deck'

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
  const order = async () => (await (await sodaRouter.request('/order/latest', { headers: { Authorization: 'Bearer purchaser-token' } }, env))
    .json() as { items: Array<{ soda_id: number; rank: number }> }).items
  const likeTarget = (count: number) => {
    for (let n = 100; n < 100 + count; n++) sqlite.prepare("INSERT INTO soda_reports (session_key, soda_id, verdict) VALUES (?, ?, 'like')").run(session(n), target)
  }
  return { sqlite, env, target, report, swipe, get, admin, shownIn, order, likeTarget }
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

  test('a ban after this week\'s list was written drops the drink from /order/latest at once, ranks renumbered', async () => {
    const { report, admin, target, order, likeTarget } = setup()
    likeTarget(20)
    await admin('POST', '/soda/regenerate')
    const before = await order()
    expect(before.some((item) => item.soda_id === target)).toBe(true)

    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    // No regenerate: the stored snapshot still lists the drink, the read filters it out.
    const after = await order()
    expect(after.map((item) => item.soda_id)).toEqual(before.map((item) => item.soda_id).filter((id) => id !== target))
    expect(after.map((item) => item.rank)).toEqual(after.map((_, index) => index + 1))
  })

  test('an inactive drink that is also banned answers 404, not 409', async () => {
    const { report, swipe, sqlite, target } = setup()
    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    sqlite.prepare('UPDATE sodas SET is_active = 0 WHERE id = ?').run(target)
    const rejected = [await report(7, 'like'), await swipe(8)]
    for (const res of rejected) {
      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  test('the admin unknown-scan picks name a banned drink with a "(banned)" suffix', async () => {
    const { report, admin, sqlite, target } = setup()
    sqlite.prepare("INSERT INTO soda_unknown_scans (code, format, session_key, resolved_soda_id, resolved_by) VALUES ('099999999993', 'ean_13', ?, ?, 'voter')")
      .run(session(60), target)
    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    const body = JSON.stringify(await (await admin('GET', '/soda/unknown-scans')).json())
    expect(body).toContain('Coca-Cola Original (banned)')
  })
})

describe('admin unban (soda_ban_overrides)', () => {
  test('unban shows the drink again until SODA_BAN_HATES new hates; the 5th new hate re-bans it', async () => {
    const { report, admin, target, shownIn, likeTarget } = setup()
    likeTarget(20)
    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    expect(await shownIn()).toEqual(everywhere(false))

    const res = await admin('POST', `/soda/banned/${target}/unban`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: target, hates_at_override: 5 })
    expect(await shownIn()).toEqual(everywhere(true))
    expect((await (await admin('GET', '/soda/banned')).json() as { banned: unknown[] }).banned).toEqual([])

    // Stuffing the same drink again needs 5 more distinct voters.
    for (let n = 11; n <= 14; n++) expect((await report(n, 'hate')).status).toBe(200)
    expect(await shownIn()).toEqual(everywhere(true))
    expect((await report(15, 'hate')).status).toBe(200)
    expect(await shownIn()).toEqual(everywhere(false))
    expect((await report(16, 'hate')).status).toBe(409)

    // It can be unbanned again; the override moves to the new count.
    const again = await admin('POST', `/soda/banned/${target}/unban`)
    expect(await again.json()).toEqual({ id: target, hates_at_override: 10 })
    expect((await shownIn()).catalog).toBe(true)
  })

  test('only a banned, active drink can be unbanned, and only by an admin', async () => {
    const { report, admin, target, sqlite, env } = setup()
    expect((await admin('POST', `/soda/banned/${target}/unban`)).status).toBe(404)
    expect((await admin('POST', '/soda/banned/999999/unban')).status).toBe(404)
    expect((await admin('POST', '/soda/banned/abc/unban')).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_ban_overrides').get()!.n).toBe(0)

    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    const purchaser = await adminRouter.request(`/soda/banned/${target}/unban`, { method: 'POST', headers: { Authorization: 'Bearer purchaser-token' } }, env)
    expect(purchaser.status).toBe(401)
    const anonymous = await adminRouter.request(`/soda/banned/${target}/unban`, { method: 'POST' }, env)
    expect(anonymous.status).toBe(401)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_ban_overrides').get()!.n).toBe(0)

    sqlite.prepare('UPDATE sodas SET is_active = 0 WHERE id = ?').run(target)
    expect((await admin('POST', `/soda/banned/${target}/unban`)).status).toBe(404)
  })
})

describe('/deck with a banned drink (#298 x #300)', () => {
  test('a drink with 5 hates is absent from every feed, and its brand-mates weigh below an untried clean-brand drink', async () => {
    const { report, get, target, sqlite, env } = setup()
    for (let n = 1; n <= 5; n++) await report(n, 'hate')
    const brandMate = Number(sqlite.prepare("SELECT id FROM sodas WHERE brand = 'Coca-Cola' AND id <> ? AND is_active = 1 AND type = 'soda' ORDER BY id LIMIT 1").get(target)!.id)
    const clean = Number(sqlite.prepare("SELECT id FROM sodas WHERE brand = 'Pepsi' AND is_active = 1 AND type = 'soda' ORDER BY id LIMIT 1").get()!.id)

    // (b) The scoring loader carries the banned drink's hates into the Coca-Cola brand prior.
    const scored = scoreDrinks(await loadScoringStats(env.DB))
    expect(scored.some((d) => d.id === target)).toBe(false)
    const weight = (id: number) => deckWeight(scored.find((d) => d.id === id)!)
    expect(weight(brandMate)).toBeLessThan(weight(clean))

    // (a) and (b) end to end: across many voters, the banned drink never shows and the mate
    // comes before the clean-brand drink less than half the time.
    let mateFirst = 0
    const voters = 200
    for (let v = 0; v < voters; v++) {
      const ids = (await get<{ sodas: Array<{ id: number }> }>('/deck', { 'X-Lunchbench-Session': session(5000 + v) })).sodas.map((d) => d.id)
      expect(ids).not.toContain(target)
      if (ids.indexOf(brandMate) < ids.indexOf(clean)) mateFirst += 1
    }
    expect(mateFirst / voters).toBeLessThan(0.4)
  })
})
