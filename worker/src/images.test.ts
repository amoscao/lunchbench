import { describe, expect, test, vi } from 'vitest'
import { MAX_IMAGE_SIZE_BYTES } from './image-validator'
import { handleImageUpload, imagesRouter } from './routes/images'
import type { Bindings } from './types'

function mockDb(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('admin_sessions')) {
                return { role: 'lunch', expires_at: new Date(Date.now() + 60_000).toISOString() }
              }
              if (sql.includes('rate_limits')) {
                return { count: 1, window_start: new Date().toISOString() }
              }
              if (sql.includes('SELECT id FROM lunches')) {
                return { id: 1 }
              }
              return null
            },
            async run() {
              return { success: true, meta: { changes: 1 } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

function mockImageEnv(get = vi.fn()): Bindings {
  return {
    DB: {} as D1Database,
    IMAGES: { get } as unknown as R2Bucket,
    VOTE_PASSWORD: 'test-admin-token',
    ADMIN_MANAGER_PASSWORD: 'test-admin-password',
    SENTRY_DSN: '',
  }
}

describe('image serving', () => {
  test('serves a valid public image key', async () => {
    const key = 'images/123e4567-e89b-42d3-a456-426614174000.jpg'
    const get = vi.fn().mockResolvedValue({
      body: new Blob(['image-bytes']).stream(),
      httpMetadata: { contentType: 'image/jpeg' },
    })

    const response = await imagesRouter.request(`/${key}`, { method: 'GET' }, mockImageEnv(get))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    await expect(response.text()).resolves.toBe('image-bytes')
    expect(get).toHaveBeenCalledWith(key)
  })

  test('returns 404 for invalid image key patterns', async () => {
    const get = vi.fn()

    const response = await imagesRouter.request('/private/secret.txt', { method: 'GET' }, mockImageEnv(get))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found', code: 'NOT_FOUND' })
    expect(get).not.toHaveBeenCalled()
  })

  test('returns 404 for path traversal attempts', async () => {
    const get = vi.fn()

    const response = await imagesRouter.request('/images/%2E%2E/secret.txt', { method: 'GET' }, mockImageEnv(get))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found', code: 'NOT_FOUND' })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('image upload', () => {
  test('rejects oversized raw bodies before multipart parsing', async () => {
    const bodySize = Math.ceil(MAX_IMAGE_SIZE_BYTES * 1.1) + 1
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bodySize))
        controller.close()
      },
    })
    const request = new Request('https://api.example.test/api/lunches/1/image', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-session',
        'Content-Type': 'multipart/form-data; boundary=missing',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const response = await handleImageUpload(request, 1, mockDb(), {} as R2Bucket)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: 'File exceeds 5MB limit',
      code: 'PAYLOAD_TOO_LARGE',
    })
  })
})
