import { afterEach, describe, expect, test, vi } from 'vitest'
import { isSodaBannedError, submitSodaReport, submitSodaSwipe } from './api'

// #298: a drink banned after the page loaded answers 409 SODA_BANNED; callers treat that apart from failures.
function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })))
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (e) {
    return e
  }
  throw new Error('expected a rejection')
}

describe('SODA_BANNED errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('a 409 SODA_BANNED swipe or report is recognised', async () => {
    respond(409, { error: 'Soda is banned', code: 'SODA_BANNED' })
    expect(isSodaBannedError(await caught(submitSodaSwipe(1, 'right')))).toBe(true)
    expect(isSodaBannedError(await caught(submitSodaReport(1, 'hate')))).toBe(true)
  })

  test('other failures are not', async () => {
    respond(404, { error: 'Soda not found', code: 'NOT_FOUND' })
    expect(isSodaBannedError(await caught(submitSodaSwipe(1, 'right')))).toBe(false)
    respond(500, 'not json')
    expect(isSodaBannedError(await caught(submitSodaReport(1, 'like')))).toBe(false)
    expect(isSodaBannedError(new Error('network'))).toBe(false)
  })
})
