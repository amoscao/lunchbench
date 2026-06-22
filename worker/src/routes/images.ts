import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from '../helpers'
import { checkRateLimit } from '../rate-limit'
import { MAX_IMAGE_SIZE_BYTES, validateImageBuffer } from '../image-validator'
import { resizeImage } from '../image-resize'
import { isAllowedOrigin } from '../middleware'

const images = new Hono<{ Bindings: Bindings }>()
const MAX_MULTIPART_BODY_BYTES = Math.ceil(MAX_IMAGE_SIZE_BYTES * 1.1)

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

async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<ArrayBuffer | null> {
  if (!body) return new ArrayBuffer(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return null
      }

      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const rawBody = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    rawBody.set(chunk, offset)
    offset += chunk.byteLength
  }

  return rawBody.buffer
}

// Upload handler - exported separately for use in lunches router
export async function handleImageUpload(
  request: Request,
  lunchId: number,
  db: D1Database,
  bucket: R2Bucket | undefined
): Promise<Response> {
  if (!(await validateAdminSession(request, db, 'lunch'))) {
    return Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const origin = request.headers.get('Origin')
  if (origin && !isAllowedOrigin(origin)) {
    return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
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
    const rawBody = await readBodyWithinLimit(request.body, MAX_MULTIPART_BODY_BYTES)
    if (rawBody === null) {
      return Response.json({ error: 'File exceeds 5MB limit', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
    }

    const checkedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: rawBody,
    })
    formData = await checkedRequest.formData()
  } catch {
    return Response.json({ error: 'Invalid form data', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const file = formData.get('image')
  if (file === null || typeof file !== 'object' || !('arrayBuffer' in file) || !('size' in file)) {
    return Response.json({ error: 'image field is required', code: 'BAD_REQUEST' }, { status: 400 })
  }

  const imageFile = file as File
  if (imageFile.size > MAX_IMAGE_SIZE_BYTES) {
    return Response.json({ error: 'File exceeds 5MB limit', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
  }

  const buf = await imageFile.arrayBuffer()
  const validation = validateImageBuffer(buf, imageFile.size)
  if (!validation.valid) {
    return Response.json({ error: validation.error, code: 'INVALID_IMAGE' }, { status: validation.status })
  }

  const resizedBuf = await resizeImage(buf, validation.contentType)
  const key = `images/${crypto.randomUUID()}.${validation.ext}`

  await bucket.put(key, resizedBuf, {
    httpMetadata: { contentType: validation.contentType },
  })

  await db.prepare('UPDATE lunches SET image_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, new Date().toISOString(), lunchId)
    .run()

  const imageUrl = `/api/images/${key}`
  return Response.json({ image_key: key, image_url: imageUrl })
}
