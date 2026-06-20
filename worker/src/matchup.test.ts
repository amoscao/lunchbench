import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectMatchup } from './matchup'

const makeLunches = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Lunch ${i + 1}`,
    rating: 1500 + i * 100,
    glicko_rd: 100,
  }))

describe('selectMatchup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when fewer than 2 lunches', () => {
    expect(selectMatchup([], [])).toBeNull()
    expect(selectMatchup([{ id: 1, rating: 1500, glicko_rd: 100 }], [])).toBeNull()
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
    const recentPairs: [number, number][] = [[1, 2]]

    for (let i = 0; i < 50; i++) {
      const result = selectMatchup(lunches, recentPairs)!
      const ids = [result[0].id, result[1].id].sort()
      expect(ids).not.toEqual([1, 2])
    }
  })

  it('weights anchor selection by higher glicko_rd', () => {
    const lunches = [
      { id: 1, name: 'Low uncertainty', rating: 1200, glicko_rd: 10 },
      { id: 2, name: 'High uncertainty', rating: 1600, glicko_rd: 90 },
      { id: 3, name: 'Close opponent', rating: 1650, glicko_rd: 10 },
    ]
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.75)

    const result = selectMatchup(lunches, [])!

    expect(result.map((lunch) => lunch.id)).toEqual([2, 3])
  })

  it('picks the closest-rated opponent while excluding recent pairs', () => {
    const lunches = [
      { id: 1, name: 'Anchor', rating: 1500, glicko_rd: 100 },
      { id: 2, name: 'Recent close opponent', rating: 1510, glicko_rd: 100 },
      { id: 3, name: 'Allowed opponent', rating: 1530, glicko_rd: 100 },
      { id: 4, name: 'Distant opponent', rating: 1900, glicko_rd: 100 },
    ]
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75)

    const result = selectMatchup(lunches, [[1, 2]])!

    expect(result.map((lunch) => lunch.id)).toEqual([1, 3])
  })

  it('randomly swaps left and right sides', () => {
    const lunches = makeLunches(2)
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.25)

    const result = selectMatchup(lunches, [])!

    expect(result.map((lunch) => lunch.id)).toEqual([2, 1])
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
