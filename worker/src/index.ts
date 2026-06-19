import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings } from './types'
import { lunchesRouter } from './routes/lunches'
import { matchupRouter } from './routes/matchup'
import { voteRouter } from './routes/vote'
import { imagesRouter } from './routes/images'
import { handleImageUpload } from './routes/images'
import { adminRouter } from './routes/admin'
import { securityHeaders } from './middleware'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())
app.use('*', securityHeaders)

app.get('/api/health', (c) => c.json({ ok: true }))

app.route('/api/lunches', lunchesRouter)
app.route('/api/matchup', matchupRouter)
app.route('/api/vote', voteRouter)
app.route('/api/images', imagesRouter)
app.route('/api/admin', adminRouter)

// Image upload route (needs raw request access)
app.post('/api/lunches/:id/image', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)
  return handleImageUpload(c.req.raw, id, c.env.DB, c.env.IMAGES, c.env.VOTE_PASSWORD)
})

export default app
