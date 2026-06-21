import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import type { Bindings, LunchRow } from '../types'
import { lunchFromRow } from '../helpers'
import { checkRateLimit, getClientIp } from '../rate-limit'

type AdminEnv = { Bindings: Bindings }

const admin = new Hono<{ Bindings: Bindings }>()

admin.post('/verify', async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env.DB, ip, 'admin_verify', 5, 3600)
  if (!rl.allowed) {
    return c.json({ error: 'Too many attempts', code: 'RATE_LIMITED' }, 429)
  }

  const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}))
  if (!body.password) {
    return c.json({ error: 'Password required', code: 'BAD_REQUEST' }, 400)
  }

  const pw = body.password
  const stored = c.env.ADMIN_MANAGER_PASSWORD
  if (pw.length !== stored.length) {
    return c.json({ error: 'Invalid password', code: 'UNAUTHORIZED' }, 401)
  }

  const a = new TextEncoder().encode(pw)
  const b = new TextEncoder().encode(stored)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  if (diff !== 0) {
    return c.json({ error: 'Invalid password', code: 'UNAUTHORIZED' }, 401)
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO admin_sessions (token, expires_at) VALUES (?, ?)'
  ).bind(token, expiresAt).run()

  return c.json({ token })
})

async function requireAdminSession(c: Context<AdminEnv>, next: Next): Promise<Response | void> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    'SELECT expires_at FROM admin_sessions WHERE token = ?'
  ).bind(token).first<{ expires_at: string }>()

  if (!session || new Date(session.expires_at) < new Date()) {
    return c.json({ error: 'Session expired', code: 'UNAUTHORIZED' }, 401)
  }

  await next()
}

admin.get('/lunches', requireAdminSession, async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM lunches ORDER BY id ASC'
  ).all<LunchRow>()
  const baseUrl = new URL(c.req.url).origin
  return c.json({
    lunches: result.results.map((r) => lunchFromRow(r, baseUrl)),
  })
})

admin.patch('/lunches/:id', requireAdminSession, async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)

  const body = await c.req.json<{
    name?: string
    description?: string | null
    is_vegan?: boolean
  }>().catch((): { name?: string; description?: string | null; is_vegan?: boolean } => ({}))

  const updates: string[] = []
  const values: (string | number | null)[] = []

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name || name.length > 100) {
      return c.json({ error: 'Invalid name', code: 'BAD_REQUEST' }, 400)
    }
    updates.push('name = ?')
    values.push(name)
  }

  if (body.description !== undefined) {
    updates.push('description = ?')
    values.push(body.description)
  }

  if (body.is_vegan !== undefined) {
    updates.push('is_vegan = ?')
    values.push(body.is_vegan ? 1 : 0)
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update', code: 'BAD_REQUEST' }, 400)
  }

  updates.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  await c.env.DB.prepare(
    `UPDATE lunches SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run()

  const row = await c.env.DB.prepare('SELECT * FROM lunches WHERE id = ?').bind(id).first<LunchRow>()
  if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)

  const baseUrl = new URL(c.req.url).origin
  return c.json({ lunch: lunchFromRow(row, baseUrl) })
})

admin.delete('/lunches/:id', requireAdminSession, async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM votes WHERE left_lunch_id = ? OR right_lunch_id = ?').bind(id, id),
    c.env.DB.prepare('DELETE FROM lunches WHERE id = ?').bind(id),
  ])

  return c.json({ deleted: true })
})

admin.get('/stats', requireAdminSession, async (c) => {
  const now = new Date()
  const ts24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const ts7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString()
  const ts30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [r24h, r7d, r30d] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as n FROM votes WHERE created_at >= ?').bind(ts24h),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM votes WHERE created_at >= ?').bind(ts7d),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM votes WHERE created_at >= ?').bind(ts30d),
  ])

  return c.json({
    votes_24h: (r24h.results[0] as { n: number }).n,
    votes_7d:  (r7d.results[0]  as { n: number }).n,
    votes_30d: (r30d.results[0] as { n: number }).n,
  })
})

admin.post('/reset-scores', requireAdminSession, async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE lunches SET
        rating              = 1500.0,
        glicko_rd           = 350.0,
        glicko_volatility   = 0.06,
        conservative_rating = 800.0,
        wins                = 0,
        losses              = 0,
        ties                = 0,
        updated_at          = ?
    `).bind(new Date().toISOString()),
    c.env.DB.prepare('DELETE FROM votes'),
    c.env.DB.prepare("DELETE FROM rate_limits WHERE action IN ('vote', 'vote_pair')"),
  ])
  return c.json({ reset: true })
})

export { admin as adminRouter }
