import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, isLegacyLunchError, submitVote } from './api'

// #286: a vote naming a legacy lunch answers 409 LEGACY_LUNCH; the home page skips to the next matchup.
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

describe('LEGACY_LUNCH vote errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('a 409 LEGACY_LUNCH vote is recognised and keeps the API message', async () => {
    respond(409, { error: 'Legacy lunches cannot be voted on', code: 'LEGACY_LUNCH' })
    const err = await caught(submitVote(1, 2, 'left_win'))
    expect(isLegacyLunchError(err)).toBe(true)
    expect((err as ApiError).message).toBe('Legacy lunches cannot be voted on')
  })

  test('other vote failures are not', async () => {
    respond(409, { error: 'Vote conflict, please retry', code: 'CONFLICT' })
    expect(isLegacyLunchError(await caught(submitVote(1, 2, 'tie')))).toBe(false)
    respond(500, 'not json')
    const err = await caught(submitVote(1, 2, 'tie'))
    expect(isLegacyLunchError(err)).toBe(false)
    expect((err as Error).message).toBe('Vote failed: 500')
    expect(isLegacyLunchError(new Error('network'))).toBe(false)
  })
})
