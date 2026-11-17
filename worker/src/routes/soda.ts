import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from '../helpers'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '../rate-limit'
import { parseSessionKey } from './matchup'
import { buildFeed, sessionTieKey } from '../soda-deck'
import { hasData, rankForLeaderboard, scoreDrinks, sodaName, type DrinkStats } from '../soda-score'
import { seededRandom, weekStartFor, type OrderItem } from '../soda-order'
import { imageUrl, isSodaBanned, loadScoringStats, shownSodaSql, writeWeeklyOrder, type BuyListRow } from '../soda-data'
import { isBarcodeFormat, normalizeBarcode } from '../barcode'

const soda = new Hono<{ Bindings: Bindings }>()

// Writes are keyed by client IP. An office shares one IP, so limits are generous.
const SWIPE_LIMIT = { limit: 1200, windowSeconds: 3600 }
const REPORT_LIMIT = { limit: 60, windowSeconds: 3600 }
const UNKNOWN_SCAN_LIMIT = { limit: 60, windowSeconds: 3600 }
// Voter-learned barcode mappings. Stricter: anyone can submit them without logging in.
const BARCODE_LEARN_LIMIT = { limit: 20, windowSeconds: 3600 }

type SodaRow = Pick<DrinkStats, 'id' | 'brand' | 'flavor' | 'type' | 'image_key'>

function sodaCard(row: SodaRow) {
  return {
    id: row.id,
    brand: row.brand,
    flavor: row.flavor,
    name: sodaName(row),
    type: row.type,
    image_url: imageUrl(row.image_key),
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null)
  return body && typeof body === 'object' ? body as Record<string, unknown> : {}
}

/**
 * A swipe or report matched no writable drink. A banned drink (5+ Hate reports) gets 409 SODA_BANNED
 * so clients can tell it apart from an unknown or inactive one (404).
 */
async function sodaWriteRejected(c: Context<{ Bindings: Bindings }>, sodaId: number): Promise<Response> {
  if (await isSodaBanned(c.env.DB, sodaId)) {
    return c.json({ error: 'Soda is banned', code: 'SODA_BANNED' }, 409)
  }
  return c.json({ error: 'Soda not found', code: 'NOT_FOUND' }, 404)
}

// Every active, not banned drink. Report search filters this list on the client.
soda.get('/catalog', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT s.id, s.brand, s.flavor, s.type, s.image_key FROM sodas s WHERE ${shownSodaSql('s')} ORDER BY s.brand ASC, s.flavor ASC, s.id ASC`
  ).all<SodaRow>()
  return c.json(
    { sodas: result.results.map(sodaCard) },
    200,
    { 'Cache-Control': 'public, max-age=300' }
  )
})

// The voter's whole feed: every active, not banned drink they have not swiped, in a random order
// weighted toward drinks people like (see buildFeed). Scoring stats include banned drinks so their
// evidence weighs on their brand; scoreDrinks leaves the banned drinks themselves out.
soda.get('/deck', async (c) => {
  const sessionKey = parseSessionKey(c.req.header('X-Lunchbench-Session') ?? null)
  const [drinks, swipes] = await Promise.all([
    loadScoringStats(c.env.DB),
    sessionKey
      ? c.env.DB.prepare('SELECT soda_id FROM soda_swipes WHERE session_key = ?')
        .bind(sessionKey)
        .all<{ soda_id: number }>()
      : Promise.resolve({ results: [] as { soda_id: number }[] }),
  ])
  const swiped = new Set(swipes.results.map((row) => row.soda_id))
  // A per-drink random key seeded by session keeps each drink's place stable across swipes and
  // reloads. Without a session, the order is random per request.
  const randomKeys = new Map<number, number>()
  const randomKey = sessionKey
    ? sessionTieKey(sessionKey, seededRandom)
    : (id: number) => {
      if (!randomKeys.has(id)) randomKeys.set(id, Math.random())
      return randomKeys.get(id)!
    }
  const feed = buildFeed(scoreDrinks(drinks), swiped, randomKey)
  return c.json({ sodas: feed.map(sodaCard) }, 200, { 'Cache-Control': 'no-store' })
})

soda.put('/swipes', async (c) => {
  const sessionKey = parseSessionKey(c.req.header('X-Lunchbench-Session') ?? null)
  if (!sessionKey) return c.json({ error: 'Session header required', code: 'BAD_REQUEST' }, 400)

  const body = await readJson(c.req.raw)
  const sodaId = body.soda_id
  const direction = body.direction
  if (!Number.isInteger(sodaId) || (direction !== 'right' && direction !== 'left')) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400)
  }

  const rl = await checkRateLimit(c.env.DB, getClientIp(c.req.raw, c.env.PROXY_SECRET), 'soda_swipe', SWIPE_LIMIT.limit, SWIPE_LIMIT.windowSeconds)
  if (!rl.allowed) return rateLimitedResponse(c, rl, 'Too many swipes')

  const row = await c.env.DB.prepare(
    `INSERT INTO soda_swipes (session_key, soda_id, direction, swiped_at)
     SELECT ?, s.id, ?, datetime('now') FROM sodas s WHERE s.id = ? AND ${shownSodaSql('s')}
     ON CONFLICT(session_key, soda_id) DO UPDATE SET
       direction = excluded.direction,
       swiped_at = excluded.swiped_at
     RETURNING soda_id`
  ).bind(sessionKey, direction, sodaId).first<{ soda_id: number }>()
  if (!row) return sodaWriteRejected(c, sodaId as number)

  return c.json({ ok: true })
})

soda.post('/reports', async (c) => {
  const sessionKey = parseSessionKey(c.req.header('X-Lunchbench-Session') ?? null)
  if (!sessionKey) return c.json({ error: 'Session header required', code: 'BAD_REQUEST' }, 400)

  const body = await readJson(c.req.raw)
  const sodaId = body.soda_id
  const verdict = body.verdict
  if (!Number.isInteger(sodaId) || (verdict !== 'like' && verdict !== 'hate')) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400)
  }
  // Optional: the unknown barcode this voter scanned before picking the drink manually.
  const hasBarcode = body.barcode !== undefined && body.barcode !== null
  const barcode = hasBarcode ? normalizeBarcode(body.barcode) : null
  if (hasBarcode && !barcode) {
    return c.json({ error: 'Invalid barcode', code: 'BAD_REQUEST' }, 400)
  }

  const rl = await checkRateLimit(c.env.DB, getClientIp(c.req.raw, c.env.PROXY_SECRET), 'soda_report', REPORT_LIMIT.limit, REPORT_LIMIT.windowSeconds)
  if (!rl.allowed) return rateLimitedResponse(c, rl, 'Too many reports')

  const row = await c.env.DB.prepare(
    `INSERT INTO soda_reports (session_key, soda_id, verdict, reported_at)
     SELECT ?, s.id, ?, datetime('now') FROM sodas s WHERE s.id = ? AND ${shownSodaSql('s')}
     ON CONFLICT(session_key, soda_id) DO UPDATE SET
       verdict = excluded.verdict,
       reported_at = excluded.reported_at
     RETURNING soda_id`
  ).bind(sessionKey, verdict, sodaId).first<{ soda_id: number }>()
  if (!row) return sodaWriteRejected(c, sodaId as number)

  if (!barcode) return c.json({ ok: true })
  const mappedSodaId = await learnBarcode(c.env.DB, getClientIp(c.req.raw, c.env.PROXY_SECRET), sessionKey, barcode, row.soda_id)
  return c.json({ ok: true, barcode_soda_id: mappedSodaId })
})

/**
 * Resolves this voter's latest unresolved unknown scan of `code` to the drink they reported, then
 * maps the code to that drink with source 'voter' if nobody mapped it yet (first mapping wins).
 * Learning needs that scan row, so a report cannot map a code its voter never logged as unknown.
 * Returns the drink the code maps to afterwards, or null.
 */
async function learnBarcode(db: D1Database, ip: string, sessionKey: string, code: string, sodaId: number): Promise<number | null> {
  const resolved = await db.prepare(
    `UPDATE soda_unknown_scans SET resolved_soda_id = ?, resolved_by = 'voter'
     WHERE id = (
       SELECT id FROM soda_unknown_scans
       WHERE session_key = ? AND code = ? AND resolved_soda_id IS NULL
       ORDER BY id DESC LIMIT 1
     )
     RETURNING id`
  ).bind(sodaId, sessionKey, code).first<{ id: number }>()
  if (resolved) {
    const rl = await checkRateLimit(db, ip, 'soda_barcode_learn', BARCODE_LEARN_LIMIT.limit, BARCODE_LEARN_LIMIT.windowSeconds)
    if (rl.allowed) {
      await db.prepare(
        `INSERT INTO soda_barcodes (code, soda_id, source) VALUES (?, ?, 'voter')
         ON CONFLICT(code) DO NOTHING`
      ).bind(code, sodaId).run()
    }
  }
  const mapping = await db.prepare(
    `SELECT b.soda_id FROM soda_barcodes b JOIN sodas s ON s.id = b.soda_id WHERE b.code = ? AND ${shownSodaSql('s')}`
  ).bind(code).first<{ soda_id: number }>()
  return mapping?.soda_id ?? null
}

// Every barcode mapped to an active, not banned drink. The client fetches this once and looks scans up locally.
soda.get('/barcodes', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT b.code, b.soda_id FROM soda_barcodes b
     JOIN sodas s ON s.id = b.soda_id
     WHERE ${shownSodaSql('s')}
     ORDER BY b.code ASC`
  ).all<{ code: string; soda_id: number }>()
  return c.json({ barcodes: result.results }, 200, { 'Cache-Control': 'no-cache' })
})

// Logs a scanned barcode that matched no known drink, for the admin "Unknown scans" list.
// The body is the decoded string and its symbology only. No image data is accepted.
soda.post('/unknown-scans', async (c) => {
  const sessionKey = parseSessionKey(c.req.header('X-Lunchbench-Session') ?? null)
  if (!sessionKey) return c.json({ error: 'Session header required', code: 'BAD_REQUEST' }, 400)

  const body = await readJson(c.req.raw)
  const format = body.format
  if (!isBarcodeFormat(format)) {
    return c.json({ error: 'Invalid format', code: 'BAD_REQUEST' }, 400)
  }
  const code = normalizeBarcode(body.barcode, format)
  if (!code) return c.json({ error: 'Invalid barcode', code: 'BAD_REQUEST' }, 400)

  const rl = await checkRateLimit(c.env.DB, getClientIp(c.req.raw, c.env.PROXY_SECRET), 'soda_unknown_scan', UNKNOWN_SCAN_LIMIT.limit, UNKNOWN_SCAN_LIMIT.windowSeconds)
  if (!rl.allowed) return rateLimitedResponse(c, rl, 'Too many scans')

  await c.env.DB.prepare(
    'INSERT INTO soda_unknown_scans (code, format, session_key) VALUES (?, ?, ?)'
  ).bind(code, format, sessionKey).run()
  return c.json({ ok: true, code })
})

soda.get('/leaderboard', async (c) => {
  // Scoring stats include banned drinks for their brand evidence; rankForLeaderboard leaves them out.
  const ranked = rankForLeaderboard(await loadScoringStats(c.env.DB))
  return c.json(
    {
      sodas: ranked.map((drink, index) => ({
        rank: index + 1,
        ...sodaCard(drink),
        right_swipes: drink.right_swipes,
        left_swipes: drink.left_swipes,
        likes: drink.likes,
        hates: drink.hates,
        reporters: drink.reporters,
        score: drink.score,
        has_data: hasData(drink),
      })),
    },
    200,
    { 'Cache-Control': 'no-cache, s-maxage=60' }
  )
})

soda.get('/order/latest', async (c) => {
  if (!(await validateAdminSession(c.req.raw, c.env.DB, 'purchaser'))) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const now = new Date()
  const current = await c.env.DB.prepare('SELECT week_start FROM soda_buy_lists WHERE week_start = ?')
    .bind(weekStartFor(now))
    .first<{ week_start: string }>()
  // Fresh deploy or the cron has not fired yet this week.
  if (!current) await writeWeeklyOrder(c.env.DB, now, 'keep')

  const row = await c.env.DB.prepare(
    'SELECT week_start, generated_at, items_json, params_json FROM soda_buy_lists ORDER BY week_start DESC LIMIT 1'
  ).first<BuyListRow>()
  if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)

  // Snapshots written before backups were removed may still hold "backup" rows. They were the last
  // ranks, so dropping them on read keeps ranks 1..n contiguous.
  const stored = (JSON.parse(row.items_json) as Array<Omit<OrderItem, 'slot'> & { slot: string }>)
    .filter((item) => item.slot !== 'backup')
  // A drink banned (or deactivated) after the snapshot was written leaves Chris's list at once. The
  // rest keep their order and are renumbered; nothing is recomputed to replace it.
  const ids = [...new Set(stored.map((item) => item.soda_id))]
  const shown = ids.length === 0
    ? new Set<number>()
    : new Set((await c.env.DB.prepare(
      `SELECT s.id FROM sodas s WHERE s.id IN (${ids.map(() => '?').join(', ')}) AND ${shownSodaSql('s')}`
    ).bind(...ids).all<{ id: number }>()).results.map((r) => r.id))
  const items = stored
    .filter((item) => shown.has(item.soda_id))
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      name: sodaName(item),
      image_url: imageUrl(item.image_key),
    }))
  return c.json(
    { week_start: row.week_start, generated_at: row.generated_at, items },
    200,
    { 'Cache-Control': 'no-store' }
  )
})

export { soda as sodaRouter }
