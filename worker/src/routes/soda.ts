import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from '../helpers'
import { checkRateLimit, getClientIp } from '../rate-limit'
import { parseSessionKey } from './matchup'
import { buildFeed, sessionTieKey } from '../soda-deck'
import { hasData, rankForLeaderboard, sodaName, type DrinkStats } from '../soda-score'
import { seededRandom, weekStartFor, type OrderItem } from '../soda-order'
import { imageUrl, loadDrinkStats, writeWeeklyOrder, type BuyListRow } from '../soda-data'

const soda = new Hono<{ Bindings: Bindings }>()

// Writes are keyed by client IP. An office shares one IP, so limits are generous.
const SWIPE_LIMIT = { limit: 1200, windowSeconds: 3600 }
const REPORT_LIMIT = { limit: 60, windowSeconds: 3600 }

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

soda.get('/catalog', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, brand, flavor, type, image_key FROM sodas WHERE is_active = 1 ORDER BY brand ASC, flavor ASC, id ASC'
  ).all<SodaRow>()
  return c.json(
    { sodas: result.results.map(sodaCard) },
    200,
    { 'Cache-Control': 'public, max-age=300' }
  )
})

// The voter's whole feed: every active drink they have not swiped, in priority order.
soda.get('/deck', async (c) => {
  const sessionKey = parseSessionKey(c.req.header('X-Lunchbench-Session') ?? null)
  const [drinks, swipes] = await Promise.all([
    loadDrinkStats(c.env.DB),
    sessionKey
      ? c.env.DB.prepare('SELECT soda_id FROM soda_swipes WHERE session_key = ?')
        .bind(sessionKey)
        .all<{ soda_id: number }>()
      : Promise.resolve({ results: [] as { soda_id: number }[] }),
  ])
  const swiped = new Set(swipes.results.map((row) => row.soda_id))
  // A per-drink key seeded by session keeps each drink's place stable across swipes and reloads.
  // Without a session, ties are random per request.
  const randomKeys = new Map<number, number>()
  const tieKey = sessionKey
    ? sessionTieKey(sessionKey, seededRandom)
    : (id: number) => {
      if (!randomKeys.has(id)) randomKeys.set(id, Math.random())
      return randomKeys.get(id)!
    }
  const feed = buildFeed(drinks, swiped, tieKey)
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

  const rl = await checkRateLimit(c.env.DB, getClientIp(c.req.raw), 'soda_swipe', SWIPE_LIMIT.limit, SWIPE_LIMIT.windowSeconds)
  if (!rl.allowed) return c.json({ error: 'Too many swipes', code: 'RATE_LIMITED' }, 429)

  const row = await c.env.DB.prepare(
    `INSERT INTO soda_swipes (session_key, soda_id, direction, swiped_at)
     SELECT ?, id, ?, datetime('now') FROM sodas WHERE id = ? AND is_active = 1
     ON CONFLICT(session_key, soda_id) DO UPDATE SET
       direction = excluded.direction,
       swiped_at = excluded.swiped_at
     RETURNING soda_id`
  ).bind(sessionKey, direction, sodaId).first<{ soda_id: number }>()
  if (!row) return c.json({ error: 'Soda not found', code: 'NOT_FOUND' }, 404)

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

  const rl = await checkRateLimit(c.env.DB, getClientIp(c.req.raw), 'soda_report', REPORT_LIMIT.limit, REPORT_LIMIT.windowSeconds)
  if (!rl.allowed) return c.json({ error: 'Too many reports', code: 'RATE_LIMITED' }, 429)

  const row = await c.env.DB.prepare(
    `INSERT INTO soda_reports (session_key, soda_id, verdict, reported_at)
     SELECT ?, id, ?, datetime('now') FROM sodas WHERE id = ? AND is_active = 1
     ON CONFLICT(session_key, soda_id) DO UPDATE SET
       verdict = excluded.verdict,
       reported_at = excluded.reported_at
     RETURNING soda_id`
  ).bind(sessionKey, verdict, sodaId).first<{ soda_id: number }>()
  if (!row) return c.json({ error: 'Soda not found', code: 'NOT_FOUND' }, 404)

  return c.json({ ok: true })
})

soda.get('/leaderboard', async (c) => {
  const ranked = rankForLeaderboard(await loadDrinkStats(c.env.DB))
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
  const items = (JSON.parse(row.items_json) as Array<Omit<OrderItem, 'slot'> & { slot: string }>)
    .filter((item) => item.slot !== 'backup')
    .map((item) => ({
      ...item,
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
