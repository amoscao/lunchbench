import { describe, expect, test } from 'vitest'
import type { LunchRow } from './types'
import { getVotePairRateLimitKey, MAX_VOTE_WRITE_ATTEMPTS, recordVoteWithRetry } from './routes/vote'

function lunchRow(id: number): LunchRow {
  return {
    id,
    name: `Lunch ${id}`,
    description: null,
    image_key: null,
    is_vegan: 0,
    rating: 1500,
    glicko_rd: 350,
    glicko_volatility: 0.06,
    conservative_rating: 800,
    wins: 0,
    losses: 0,
    ties: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function fakeDb(batchVoteIds: Array<number | null>): D1Database & { batchCalls: number } {
  const rows = new Map<number, LunchRow>([
    [1, lunchRow(1)],
    [2, lunchRow(2)],
  ])
  const db = {
    batchCalls: 0,
    prepare() {
      let bound: unknown[] = []
      return {
        bind(...args: unknown[]) {
          bound = args
          return this
        },
        async first() {
          return rows.get(bound[0] as number) ?? null
        },
      }
    },
    async batch() {
      const voteId = batchVoteIds[this.batchCalls] ?? null
      this.batchCalls += 1
      return [
        { results: [{ id: 1 }, { id: 2 }] },
        { results: voteId === null ? [] : [{ id: voteId }] },
      ]
    },
  }
  return db as unknown as D1Database & { batchCalls: number }
}

describe('recordVoteWithRetry', () => {
  test('retries stale guarded writes before reporting conflict', async () => {
    const db = fakeDb(Array.from({ length: MAX_VOTE_WRITE_ATTEMPTS }, () => null))

    const result = await recordVoteWithRetry(db, 1, 2, 'left_win', 'test-voter')

    expect(result).toEqual({ status: 'conflict' })
    expect(db.batchCalls).toBe(MAX_VOTE_WRITE_ATTEMPTS)
  })

  test('returns the vote id when a retry succeeds', async () => {
    const db = fakeDb([null, 42])

    const result = await recordVoteWithRetry(db, 1, 2, 'left_win', 'test-voter')

    expect(result).toEqual({ status: 'ok', voteId: 42 })
    expect(db.batchCalls).toBe(2)
  })
})

describe('getVotePairRateLimitKey', () => {
  test('hashes the IP and normalizes lunch pair order', async () => {
    const forward = await getVotePairRateLimitKey('203.0.113.5', 9, 2)
    const reverse = await getVotePairRateLimitKey('203.0.113.5', 2, 9)

    expect(forward).toBe(reverse)
    expect(forward).toMatch(/^vote_pair_[a-f0-9]{64}_2_9$/)
    expect(forward).not.toContain('203.0.113.5')
  })
})
