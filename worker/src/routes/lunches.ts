import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow, validateAdminSession } from '../helpers'
import { checkRateLimit, getClientIp } from '../rate-limit'
import { computeConsistency, confidenceFromRd, consistencyBand, GLICKO_DEFAULTS } from '../elo'
import type { LunchRow } from '../types'

const lunches = new Hono<{ Bindings: Bindings }>()

lunches.get('/', async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env.DB, ip, 'lunches_list', 120, 3600)
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rl.retryAfter ?? 3600) }
    )
  }

  const missingImage = c.req.query('missing_image') === 'true'
  const query = missingImage
    ? 'SELECT * FROM lunches WHERE image_key IS NULL ORDER BY name ASC'
    : 'SELECT * FROM lunches ORDER BY name ASC'
  const result = await c.env.DB.prepare(query).all<LunchRow>()
  const baseUrl = new URL(c.req.url).origin
  return c.json({ lunches: result.results.map((r) => lunchFromRow(r, baseUrl)) })
})

lunches.get('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)
  }

  const row = await c.env.DB.prepare('SELECT * FROM lunches WHERE id = ?').bind(id).first<LunchRow>()
  if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)

  const momentum = 0
  const baseUrl = new URL(c.req.url).origin
  const lunch = lunchFromRow(row, baseUrl)
  const consistency = computeConsistency(row.wins, row.losses, row.ties)

  return c.json(
    {
      ...lunch,
      glicko_rd: row.glicko_rd,
      glicko_volatility: row.glicko_volatility,
      conservative_rating: row.conservative_rating,
      confidence: confidenceFromRd(row.glicko_rd),
      consistency,
      consistency_band: consistencyBand(consistency),
      win_rate: (row.wins + row.losses + row.ties) > 0 ? row.wins / (row.wins + row.losses + row.ties) : 0,
      momentum,
    },
    200,
    { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
  )
})

lunches.get('/leaderboard', async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env.DB, ip, 'lunches_leaderboard', 60, 3600)
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rl.retryAfter ?? 3600) }
    )
  }

  const veganOnly = c.req.query('vegan') === 'true'

  const dataQuery = veganOnly
    ? 'SELECT * FROM lunches WHERE is_vegan = 1 ORDER BY conservative_rating DESC, name ASC, id ASC'
    : 'SELECT * FROM lunches WHERE is_vegan = 0 ORDER BY conservative_rating DESC, name ASC, id ASC'
  const result = await c.env.DB.prepare(dataQuery).all<LunchRow>()

  const baseUrl = new URL(c.req.url).origin
  const ranked = result.results.map((r, i) => ({
    rank: i + 1,
    ...lunchFromRow(r, baseUrl),
    confidence: confidenceFromRd(r.glicko_rd),
    consistency: computeConsistency(r.wins, r.losses, r.ties),
    consistency_band: consistencyBand(computeConsistency(r.wins, r.losses, r.ties)),
    glicko_rd: r.glicko_rd,
  }))
  return c.json(
    { lunches: ranked },
    200,
    { 'Cache-Control': 'no-cache, s-maxage=60' }
  )
})

lunches.post('/', async (c) => {
  if (!(await validateAdminSession(c.req.raw, c.env.DB, 'lunch'))) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const ip = getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env.DB, ip, 'lunch_create', 10, 86400)
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rl.retryAfter ?? 3600) }
    )
  }

  const body: { name?: string; description?: unknown; is_vegan?: unknown } = await c.req
    .json<{ name?: string; description?: unknown; is_vegan?: unknown }>()
    .catch(() => ({}))
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required', code: 'BAD_REQUEST' }, 400)
  }
  if (body.name.trim().length > 100) {
    return c.json({ error: 'name must be 100 characters or fewer', code: 'BAD_REQUEST' }, 400)
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return c.json({ error: 'description must be a string', code: 'BAD_REQUEST' }, 400)
  }

  const description = typeof body.description === 'string' && body.description.trim().length > 0
    ? body.description.trim()
    : null
  if (description && description.length > 500) {
    return c.json({ error: 'description must be 500 characters or fewer', code: 'BAD_REQUEST' }, 400)
  }

  const name = body.name.trim()
  const isVegan = body.is_vegan === true ? 1 : 0
  const result = await c.env.DB.prepare(
    `INSERT INTO lunches (
      name,
      description,
      is_vegan,
      rating,
      glicko_rd,
      glicko_volatility,
      conservative_rating
    ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(
    name,
    description,
    isVegan,
    GLICKO_DEFAULTS.rating,
    GLICKO_DEFAULTS.rd,
    GLICKO_DEFAULTS.volatility,
    GLICKO_DEFAULTS.conservative_rating
  ).first<LunchRow>()

  if (!result) {
    return c.json({ error: 'Failed to create lunch', code: 'INTERNAL_ERROR' }, 500)
  }

  const baseUrl = new URL(c.req.url).origin
  return c.json({ lunch: lunchFromRow(result, baseUrl) }, 201)
})

export { lunches as lunchesRouter }
