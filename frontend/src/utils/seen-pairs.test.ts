import { beforeEach, describe, expect, test } from 'vitest'
import { hasSeen, markSeen } from './seen-pairs'

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
