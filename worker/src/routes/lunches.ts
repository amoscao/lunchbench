import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow, validateAdminToken } from '../helpers'
import { checkRateLimit, getClientIp } from '../rate-limit'
import type { LunchRow } from '../types'

const lunches = new Hono<{ Bindings: Bindings }>()

lunches.get('/', async (c) => {
  const missingImage = c.req.query('missing_image') === 'true'
  const query = missingImage
    ? 'SELECT * FROM lunches WHERE image_key IS NULL ORDER BY name ASC'
    : 'SELECT * FROM lunches ORDER BY name ASC'
  const result = await c.env.DB.prepare(query).all<LunchRow>()
  const baseUrl = new URL(c.req.url).origin
  return c.json({ lunches: result.results.map((r) => lunchFromRow(r, baseUrl)) })
})

lunches.get('/leaderboard', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM lunches ORDER BY rating DESC'
  ).all<LunchRow>()
  const baseUrl = new URL(c.req.url).origin
  const ranked = result.results.map((r, i) => ({
    rank: i + 1,
    ...lunchFromRow(r, baseUrl),
  }))
  return c.json({ lunches: ranked })
})

lunches.post('/', async (c) => {
  if (!validateAdminToken(c.req.raw, c.env.ADMIN_TOKEN)) {
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

  const body: { name?: string } = await c.req.json<{ name?: string }>().catch(() => ({}))
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required', code: 'BAD_REQUEST' }, 400)
  }
  if (body.name.trim().length > 100) {
    return c.json({ error: 'name must be 100 characters or fewer', code: 'BAD_REQUEST' }, 400)
  }

  const name = body.name.trim()
  const result = await c.env.DB.prepare(
    'INSERT INTO lunches (name) VALUES (?) RETURNING *'
  ).bind(name).first<LunchRow>()

  if (!result) {
    return c.json({ error: 'Failed to create lunch', code: 'INTERNAL_ERROR' }, 500)
  }

  const baseUrl = new URL(c.req.url).origin
  return c.json({ lunch: lunchFromRow(result, baseUrl) }, 201)
})

export { lunches as lunchesRouter }
