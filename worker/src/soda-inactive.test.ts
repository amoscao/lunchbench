import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { sodaRouter } from './routes/soda'
import { adminRouter } from './routes/admin'
import { weekStartFor } from './soda-order'
import type { Bindings } from './types'
import { createTestD1 } from '../test/sqlite-d1'

// Issue #296: OLIPOP is deactivated by 0015 and must not show up on any path.
const OLIPOP_IDS = [
  '6925003428', '6921254024', '6925153849', '6919469917', '15779650088',
  '20068306279', '20233105269', '6921204598', '7097351727',
]
const REMOVAL_SQL = readFileSync(fileURLToPath(new URL('../../migrations/0015_remove_olipop.sql', import.meta.url)), 'utf8')
const VOTER = '550e8400-e29b-41d4-a716-446655440000'

type Named = { brand?: string; name?: string; soda_id?: number; id?: number }

function setup() {
  const { db, sqlite } = createTestD1()
  const env: Bindings = { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }
  const expires = new Date(Date.now() + 86_400_000).toISOString()
  for (const role of ['admin', 'purchaser']) {
    sqlite.prepare('INSERT INTO admin_sessions (token, expires_at, role) VALUES (?, ?, ?)').run(`${role}-token`, expires, role)
  }
  const olipop = sqlite.prepare(`SELECT id FROM sodas WHERE brand = 'OLIPOP'`).all().map((row) => Number(row.id))

  // Strong history for OLIPOP: if any path leaked inactive drinks, these would rank first.
  const insertSwipe = sqlite.prepare("INSERT INTO soda_swipes (session_key, soda_id, direction) VALUES (?, ?, 'right')")
  const insertReport = sqlite.prepare("INSERT INTO soda_reports (session_key, soda_id, verdict) VALUES (?, ?, 'like')")
  for (let v = 0; v < 20; v++) {
    const session = `00000000-0000-4000-8000-${String(v).padStart(12, '0')}`
    for (const id of olipop) {
      insertSwipe.run(session, id)
      insertReport.run(session, id)
    }
  }

  const get = (path: string, headers: Record<string, string> = {}) => sodaRouter.request(path, { headers }, env)
  const send = (router: typeof sodaRouter, method: string, path: string, body: unknown, headers: Record<string, string>) =>
    router.request(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, env)
  return { sqlite, env, olipop, get, send }
}

const noOlipop = (rows: Named[]) => rows.filter((row) => row.brand === 'OLIPOP' || row.name?.startsWith('OLIPOP'))

describe('0015_remove_olipop.sql', () => {
  test('deactivates the 9 OLIPOP drinks, clears their image keys and removes their barcodes', () => {
    const { sqlite, olipop } = setup()
    expect(olipop).toHaveLength(9)
    const rows = sqlite.prepare(`SELECT walmart_item_id, is_active, image_key FROM sodas WHERE brand = 'OLIPOP'`).all()
    expect(rows.map((r) => r.walmart_item_id).sort()).toEqual([...OLIPOP_IDS].sort())
    expect(rows.every((r) => r.is_active === 0 && r.image_key === null)).toBe(true)
    const barcodes = sqlite.prepare(`SELECT COUNT(*) AS n FROM soda_barcodes WHERE soda_id IN (${olipop.join(',')})`).get()!
    expect(barcodes.n).toBe(0)
    // Every other drink is untouched.
    const others = sqlite.prepare(`SELECT COUNT(*) AS n FROM sodas WHERE brand != 'OLIPOP' AND is_active = 1 AND image_key IS NOT NULL`).get()!
    expect(others.n).toBe(115)
  })

  test('keeps swipe and report history, and is safe to re-run', () => {
    const { sqlite, olipop } = setup()
    sqlite.exec(REMOVAL_SQL)
    const swipes = sqlite.prepare(`SELECT COUNT(*) AS n FROM soda_swipes WHERE soda_id IN (${olipop.join(',')})`).get()!
    const reports = sqlite.prepare(`SELECT COUNT(*) AS n FROM soda_reports WHERE soda_id IN (${olipop.join(',')})`).get()!
    expect(swipes.n).toBe(180)
    expect(reports.n).toBe(180)
  })
})

describe('inactive drinks are excluded everywhere', () => {
  test('catalog (report search reads this)', async () => {
    const { get } = setup()
    const body = await (await get('/catalog')).json() as { sodas: Named[] }
    expect(body.sodas).toHaveLength(115)
    expect(noOlipop(body.sodas)).toEqual([])
  })

  test('swipe feed', async () => {
    const { get } = setup()
    const body = await (await get('/deck', { 'X-Lunchbench-Session': VOTER })).json() as { sodas: Named[] }
    expect(body.sodas).toHaveLength(115)
    expect(noOlipop(body.sodas)).toEqual([])
  })

  test('soda leaderboard, even with heavy OLIPOP history', async () => {
    const { get } = setup()
    const body = await (await get('/leaderboard')).json() as { sodas: Named[] }
    expect(body.sodas).toHaveLength(115)
    expect(noOlipop(body.sodas)).toEqual([])
  })

  test('weekly order list, favorites and trial pool', async () => {
    const { env, sqlite } = setup()
    // Leave only OLIPOP trial-eligible among sodas: every other soda has 3 reporters.
    const insert = sqlite.prepare("INSERT INTO soda_reports (session_key, soda_id, verdict) VALUES (?, ?, 'hate')")
    for (const row of sqlite.prepare(`SELECT id FROM sodas WHERE brand != 'OLIPOP'`).all()) {
      for (let v = 0; v < 3; v++) insert.run(`10000000-0000-4000-8000-${String(v).padStart(12, '0')}`, row.id)
    }
    const res = await adminRouter.request('/soda/regenerate', { method: 'POST', headers: { Authorization: 'Bearer admin-token' } }, env)
    expect(res.status).toBe(200)
    const order = await (await sodaRouter.request('/order/latest', { headers: { Authorization: 'Bearer purchaser-token' } }, env)).json() as { items: Named[] }
    expect(order.items).toHaveLength(10)
    expect(noOlipop(order.items)).toEqual([])
  })

  test('regenerating replaces a stored snapshot that still lists OLIPOP', async () => {
    const { env, sqlite, olipop } = setup()
    const stale = [{ rank: 1, slot: 'top', soda_id: olipop[0], brand: 'OLIPOP', flavor: 'Vintage Cola', type: 'soda', image_key: null, right_swipes: 20, left_swipes: 0, has_data: true }]
    sqlite.prepare('INSERT INTO soda_buy_lists (week_start, generated_at, items_json, params_json) VALUES (?, ?, ?, ?)')
      .run(weekStartFor(new Date()), new Date().toISOString(), JSON.stringify(stale), '{}')
    const read = async () => (await (await sodaRouter.request('/order/latest', { headers: { Authorization: 'Bearer purchaser-token' } }, env)).json() as { items: Named[] }).items
    // The frozen snapshot is served as stored until an admin regenerates it.
    expect(noOlipop(await read())).toHaveLength(1)
    await adminRouter.request('/soda/regenerate', { method: 'POST', headers: { Authorization: 'Bearer admin-token' } }, env)
    expect(noOlipop(await read())).toEqual([])
  })

  test('barcode map', async () => {
    const { get, olipop } = setup()
    const body = await (await get('/barcodes')).json() as { barcodes: Array<{ code: string; soda_id: number }> }
    expect(body.barcodes.length).toBeGreaterThan(0)
    expect(body.barcodes.filter((row) => olipop.includes(row.soda_id))).toEqual([])
  })

  test('a former OLIPOP code can be learned for the drink a voter picks instead', async () => {
    const { send, sqlite } = setup()
    // A real OLIPOP Vintage Cola code from the shipped barcode seed (0014).
    const shipped = readFileSync(fileURLToPath(new URL('../../migrations/0014_soda_barcodes_seed.sql', import.meta.url)), 'utf8')
    const code = shipped.match(/\('(\d{13})', '7097351727'\)/)![1]
    const zevia = Number(sqlite.prepare("SELECT id FROM sodas WHERE walmart_item_id = '2444526495'").get()!.id)
    const voter = { 'X-Lunchbench-Session': VOTER }

    expect((await send(sodaRouter, 'POST', '/unknown-scans', { barcode: code, format: 'ean_13' }, voter)).status).toBeLessThan(300)
    const res = await send(sodaRouter, 'POST', '/reports', { soda_id: zevia, verdict: 'like', barcode: code }, voter)
    expect(res.status).toBe(200)
    // Had 0015 kept the OLIPOP seed mapping, ON CONFLICT DO NOTHING would block this and return null.
    expect(await res.json()).toEqual({ ok: true, barcode_soda_id: zevia })
    expect(sqlite.prepare('SELECT soda_id, source FROM soda_barcodes WHERE code = ?').get(code)).toEqual({ soda_id: zevia, source: 'voter' })
  })

  test('admin unknown-scan picks mark a removed drink "(removed)"', async () => {
    const { env, sqlite, olipop } = setup()
    sqlite.prepare("INSERT INTO soda_unknown_scans (code, format, session_key, resolved_soda_id, resolved_by) VALUES ('0012345678905', 'ean_13', ?, ?, 'voter')")
      .run(VOTER, olipop[0])
    const res = await adminRouter.request('/soda/unknown-scans', { headers: { Authorization: 'Bearer admin-token' } }, env)
    const body = await res.json() as { codes: Array<{ picks: Array<{ soda_id: number; name: string }> }> }
    expect(body.codes[0].picks).toEqual([expect.objectContaining({ soda_id: olipop[0], name: expect.stringMatching(/^OLIPOP .+ \(removed\)$/) })])
  })

  test('swipes, reports and admin barcode mappings to an inactive drink are rejected', async () => {
    const { send, olipop } = setup()
    const voter = { 'X-Lunchbench-Session': VOTER }
    expect((await send(sodaRouter, 'PUT', '/swipes', { soda_id: olipop[0], direction: 'right' }, voter)).status).toBe(404)
    expect((await send(sodaRouter, 'POST', '/reports', { soda_id: olipop[0], verdict: 'like' }, voter)).status).toBe(404)
    const admin = { Authorization: 'Bearer admin-token' }
    expect((await send(adminRouter, 'POST', '/soda/barcodes', { code: '012345678905', soda_id: olipop[0] }, admin)).status).toBe(404)
  })
})
