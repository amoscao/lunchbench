import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminToken } from '../helpers'
import { checkRateLimit } from '../rate-limit'
import { validateImageBuffer } from '../image-validator'

const images = new Hono<{ Bindings: Bindings }>()

// POST /api/lunches/:id/image - handled in lunches router but implemented here
// This file handles GET /api/images/:key

images.get('/:key{.+}', async (c) => {
  if (!c.env.IMAGES) {
    return c.json({ error: 'Image storage not configured', code: 'NOT_CONFIGURED' }, 503)
  }

  const key = c.req.param('key')
  const obj = await c.env.IMAGES.get(key)
  if (!obj) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)

  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return new Response(obj.body, { headers })
})

export { images as imagesRouter }

// Upload handler - exported separately for use in lunches router
export async function handleImageUpload(
  request: Request,
  lunchId: number,
  db: D1Database,
  bucket: R2Bucket | undefined,
  adminToken: string
): Promise<Response> {
  if (!validateAdminToken(request, adminToken)) {
    return Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  if (!bucket) {
    return Response.json({ error: 'Image storage not configured', code: 'NOT_CONFIGURED' }, { status: 503 })
  }

  const ip = (request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown')
  const rl = await checkRateLimit(db, ip, 'upload', 5, 86400)
  if (!rl.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 86400) } }
    )
  }

  const lunch = await db.prepare('SELECT id FROM lunches WHERE id = ?').bind(lunchId).first()
  if (!lunch) {
    return Response.json({ error: 'Lunch not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const file = formData.get('image')
  if (file === null || typeof file !== 'object' || !('arrayBuffer' in file) || !('size' in file)) {
    return Response.json({ error: 'image field is required', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const imageFile = file as File
  const buf = await imageFile.arrayBuffer()
  const validation = validateImageBuffer(buf, imageFile.size)
  if (!validation.valid) {
    return Response.json({ error: validation.error, code: 'INVALID_IMAGE' }, { status: validation.status })
  }

  const key = `images/${crypto.randomUUID()}.${validation.ext}`

  await bucket.put(key, buf, {
    httpMetadata: { contentType: validation.contentType },
  })

  await db.prepare('UPDATE lunches SET image_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, new Date().toISOString(), lunchId)
    .run()

  const imageUrl = `/api/images/${key}`
  return Response.json({ image_key: key, image_url: imageUrl })
}
