import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sentry } from '@sentry/hono/cloudflare'
import { withSentry } from '@sentry/cloudflare'
import type { Bindings } from './types'
import { lunchesRouter } from './routes/lunches'
import { matchupRouter } from './routes/matchup'
import { voteRouter } from './routes/vote'
import { imagesRouter } from './routes/images'
import { handleImageUpload } from './routes/images'
import { adminRouter } from './routes/admin'
import { sodaRouter } from './routes/soda'
import { writeWeeklyOrder } from './soda-data'
import { allowedCorsOrigin, restrictBrowserOrigins, securityHeaders } from './middleware'

export const app = new Hono<{ Bindings: Bindings }>()
const corsOptions = {
  origin: allowedCorsOrigin,
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-Lunchbench-Session'],
  maxAge: 600,
}

app.use(sentry(app, (env) => ({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 0,
  // Keep client IPs out of events (#262). Rate-limit warnings carry a keyed hash instead.
  sendDefaultPii: false,
})))
app.use('*', securityHeaders)
app.use('/api/*', restrictBrowserOrigins)
app.use('/api/*', cors(corsOptions))

app.get('/api/health', (c) => c.json({ ok: true }))

app.route('/api/lunches', lunchesRouter)
app.route('/api/matchup', matchupRouter)
app.route('/api/vote', voteRouter)
app.route('/api/images', imagesRouter)
app.route('/api/admin', adminRouter)
app.route('/api/soda', sodaRouter)

// Image upload route (needs raw request access)
app.post('/api/lunches/:id/image', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)
  return handleImageUpload(c.req.raw, id, c.env.DB, c.env.IMAGES)
})

// Weekly cron (wrangler.toml [triggers]). INSERT OR IGNORE, so a repeat firing keeps the frozen snapshot.
// It also prunes unknown-scan rows older than 180 days.
// Errors are logged and rethrown so the cron run shows as failed; withSentry reports them.
export async function runWeeklyOrder(controller: ScheduledController, env: Bindings): Promise<void> {
  try {
    await writeWeeklyOrder(env.DB, new Date(controller.scheduledTime), 'keep')
    // Privacy: the unknown-scan log keeps 180 days.
    await env.DB.prepare(
      "DELETE FROM soda_unknown_scans WHERE created_at < datetime('now', '-180 days')"
    ).run()
  } catch (error) {
    console.error('Weekly soda order failed', controller.cron, error)
    throw error
  }
}

// The Hono middleware above only instruments fetch, so Sentry wraps the scheduled handler alone.
const scheduledHandler = withSentry<Bindings>(
  (env) => ({ dsn: env.SENTRY_DSN, tracesSampleRate: 0 }),
  { scheduled: (controller, env) => runWeeklyOrder(controller, env) }
)

export const scheduled = scheduledHandler.scheduled!

export default {
  fetch: app.fetch,
  scheduled,
}
