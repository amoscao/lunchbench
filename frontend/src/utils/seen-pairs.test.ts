import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Matchup, MatchupResult } from '../api'
import { fetchUnseenMatchup, hasSeen, markSeen } from './seen-pairs'

const KEY = 'lb_seen_pairs'
const storage = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

describe('seen pairs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('records a normalized pair', () => {
    markSeen(2, 1)

    expect(hasSeen(1, 2)).toBe(true)
    expect(hasSeen(2, 1)).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['1-2'])
  })

  test('deduplicates and moves repeated pairs to the newest position', () => {
    markSeen(1, 2)
    markSeen(3, 4)
    markSeen(2, 1)

    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['3-4', '1-2'])
  })

  test('retains the 2000th entry and evicts the oldest on the 2001st entry', () => {
    for (let id = 1; id <= 2000; id += 1) {
      markSeen(id, id + 10000)
    }

    let stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
    expect(stored).toHaveLength(2000)
    expect(stored[0]).toBe('1-10001')
    expect(stored[1999]).toBe('2000-12000')
    expect(hasSeen(1, 10001)).toBe(true)
    expect(hasSeen(2000, 12000)).toBe(true)

    markSeen(2001, 12001)

    stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
    expect(stored).toHaveLength(2000)
    expect(stored[0]).toBe('2-10002')
    expect(stored[1999]).toBe('2001-12001')
  })

  test('reports evicted pairs as unseen', () => {
    for (let id = 1; id <= 2001; id += 1) {
      markSeen(id, id + 10000)
    }

    expect(hasSeen(1, 10001)).toBe(false)
    expect(hasSeen(2, 10002)).toBe(true)
    expect(hasSeen(2001, 12001)).toBe(true)
  })
})

function pair(leftId: number, rightId: number): Matchup {
  return {
    status: 'ok',
    matchup_token: `${leftId}-${rightId}`,
    left: { id: leftId },
    right: { id: rightId },
  } as Matchup
}

function fetcher(...results: Array<MatchupResult | Error>) {
  return vi.fn(async (): Promise<MatchupResult> => {
    const next = results.shift()
    if (next instanceof Error) throw next
    if (next === undefined) throw new Error('unexpected extra fetch')
    return next
  })
}

describe('fetchUnseenMatchup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('returns an unseen pair without retrying', async () => {
    const fetchMatchup = fetcher(pair(1, 2))

    await expect(fetchUnseenMatchup(fetchMatchup)).resolves.toEqual(pair(1, 2))
    expect(fetchMatchup).toHaveBeenCalledTimes(1)
  })

  test('passes through exhausted and empty results without retrying', async () => {
    const exhausted = fetcher({ status: 'exhausted' })
    await expect(fetchUnseenMatchup(exhausted)).resolves.toEqual({ status: 'exhausted' })
    expect(exhausted).toHaveBeenCalledTimes(1)

    const empty = fetcher(null)
    await expect(fetchUnseenMatchup(empty)).resolves.toBeNull()
    expect(empty).toHaveBeenCalledTimes(1)
  })

  test('replaces a seen pair with one fresh pair, in either id order', async () => {
    markSeen(1, 2)
    const fetchMatchup = fetcher(pair(2, 1), pair(3, 4))

    await expect(fetchUnseenMatchup(fetchMatchup)).resolves.toEqual(pair(3, 4))
    expect(fetchMatchup).toHaveBeenCalledTimes(2)
  })

  test('retries only once when the server keeps returning the seen pair', async () => {
    markSeen(1, 2)
    const fetchMatchup = fetcher(pair(1, 2), pair(1, 2), pair(3, 4))

    await expect(fetchUnseenMatchup(fetchMatchup)).resolves.toEqual(pair(1, 2))
    expect(fetchMatchup).toHaveBeenCalledTimes(2)
  })

  test('falls back to the original pair when the retry fails or has no pair', async () => {
    for (const retry of [new Error('network'), { status: 'exhausted' } as const, null]) {
      markSeen(1, 2)
      const original = pair(1, 2)
      const fetchMatchup = fetcher(original, retry)

      await expect(fetchUnseenMatchup(fetchMatchup)).resolves.toBe(original)
      expect(fetchMatchup).toHaveBeenCalledTimes(2)
    }
  })

  test('propagates a failure of the first fetch', async () => {
    const fetchMatchup = fetcher(new Error('rate_limited'))

    await expect(fetchUnseenMatchup(fetchMatchup)).rejects.toThrow('rate_limited')
    expect(fetchMatchup).toHaveBeenCalledTimes(1)
  })
})
