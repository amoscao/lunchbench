import { describe, it, expect } from 'vitest'
import { selectMatchup } from './matchup'

const makeLunches = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Lunch ${i + 1}` }))

describe('selectMatchup', () => {
  it('returns null when fewer than 2 lunches', () => {
    expect(selectMatchup([], [])).toBeNull()
    expect(selectMatchup([{ id: 1 }], [])).toBeNull()
  })

  it('returns two distinct lunches', () => {
    const lunches = makeLunches(5)
    const result = selectMatchup(lunches, [])
    expect(result).not.toBeNull()
    const [a, b] = result!
    expect(a.id).not.toBe(b.id)
  })

  it('avoids the most recent pair if alternatives exist', () => {
    const lunches = makeLunches(3) // ids 1, 2, 3
    // Run many times; with 3 lunches and 1 recent pair, should avoid it most of the time
    const recentPairs: [number, number][] = [[1, 2]]
    let avoidedCount = 0
    for (let i = 0; i < 50; i++) {
      const result = selectMatchup(lunches, recentPairs)!
      const ids = [result[0].id, result[1].id].sort()
      if (!(ids[0] === 1 && ids[1] === 2)) avoidedCount++
    }
    // Should avoid the recent pair in most runs (at least 60% of the time)
    expect(avoidedCount).toBeGreaterThan(30)
  })

  it('falls back to any pair when all pairs are recent (2-lunch case)', () => {
    const lunches = makeLunches(2)
    const recentPairs: [number, number][] = [[1, 2]]
    const result = selectMatchup(lunches, recentPairs)
    expect(result).not.toBeNull()
    expect(result![0].id).not.toBe(result![1].id)
  })

  it('returns exactly two lunches from the input', () => {
    const lunches = makeLunches(10)
    const [a, b] = selectMatchup(lunches, [])!
    const ids = lunches.map((l) => l.id)
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)
  })
})
