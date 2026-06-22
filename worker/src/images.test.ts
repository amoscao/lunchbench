import { describe, expect, test } from 'vitest'
import { MAX_IMAGE_SIZE_BYTES } from './image-validator'
import { handleImageUpload } from './routes/images'

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
