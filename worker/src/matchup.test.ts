import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectMatchup } from './matchup'

const makeLunches = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Lunch ${i + 1}`,
    rating: 1500 + i * 100,
    glicko_rd: 100,
  }))

function mockRandom(...values: number[]) {
  const spy = vi.spyOn(Math, 'random').mockReturnValue(0.75)
  for (const value of values) spy.mockReturnValueOnce(value)
  return spy
}

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

  it('prefers any non-recent pair when one exists', () => {
    const lunches = [
      { id: 1, name: 'Recent-only anchor', rating: 1500, glicko_rd: 1000 },
      { id: 2, name: 'Allowed anchor', rating: 1510, glicko_rd: 10 },
      { id: 3, name: 'Closest allowed opponent', rating: 1520, glicko_rd: 10 },
      { id: 4, name: 'Distant allowed opponent', rating: 1900, glicko_rd: 10 },
    ]
    mockRandom(0, 0, 0, 0, 0.75)

    const result = selectMatchup(lunches, [[1, 2], [1, 3], [1, 4]])!

    expect(result.map((lunch) => lunch.id)).toEqual([2, 3])
  })

  it('weights anchor selection by higher glicko_rd', () => {
    const lunches = [
      { id: 1, name: 'Low uncertainty', rating: 1200, glicko_rd: 10 },
      { id: 2, name: 'High uncertainty', rating: 1600, glicko_rd: 90 },
      { id: 3, name: 'Close opponent', rating: 1650, glicko_rd: 10 },
    ]
    mockRandom(0.5, 0, 0, 0.75, 0.75)

    const result = selectMatchup(lunches, [])!

    expect(result.map((lunch) => lunch.id)).toEqual([2, 3])
  })

  it('samples an allowed close opponent while excluding recent pairs', () => {
    const lunches = [
      { id: 1, name: 'Anchor', rating: 1500, glicko_rd: 100 },
      { id: 2, name: 'Recent close opponent', rating: 1510, glicko_rd: 100 },
      { id: 3, name: 'Allowed opponent', rating: 1530, glicko_rd: 100 },
      { id: 4, name: 'Distant opponent', rating: 1900, glicko_rd: 100 },
    ]
    mockRandom(0, 0, 0, 0, 0.75)

    const result = selectMatchup(lunches, [[1, 2]])!

    expect(result.map((lunch) => lunch.id)).toEqual([1, 3])
  })

  it('can select a low-RD fresh opponent instead of sticking to a stale close option', () => {
    const lunches = [
      { id: 1, name: 'Anchor', rating: 1500, glicko_rd: 350 },
      {
        id: 2,
        name: 'Low-RD fresh opponent',
        rating: 1800,
        glicko_rd: 10,
        presentation_count: 0,
      },
      {
        id: 3,
        name: 'Stale close opponent',
        rating: 1510,
        glicko_rd: 100,
        presentation_count: 100,
      },
    ]
    mockRandom(0, 1, 0, 0, 0.75)

    const result = selectMatchup(lunches, [])!

    expect(result.map((lunch) => lunch.id)).toEqual([1, 2])
  })

  it('does not always return the closest-rated opponent', () => {
    const lunches = [
      { id: 1, name: 'Anchor', rating: 1500, glicko_rd: 350 },
      { id: 2, name: 'Closest opponent', rating: 1501, glicko_rd: 100 },
      { id: 3, name: 'Nearby sampled opponent', rating: 1502, glicko_rd: 100 },
    ]
    mockRandom(0, 0, 0, 0.7, 0.75)

    const result = selectMatchup(lunches, [])!

    expect(result.map((lunch) => lunch.id)).toEqual([1, 3])
  })

  it('only pairs lunches from the same vegan group', () => {
    const lunches = [
      { id: 1, name: 'Vegan anchor', is_vegan: 1, rating: 1500, glicko_rd: 100 },
      { id: 2, name: 'Closest non-vegan', is_vegan: 0, rating: 1510, glicko_rd: 100 },
      { id: 3, name: 'Closest vegan', is_vegan: 1, rating: 1550, glicko_rd: 100 },
    ]
    mockRandom(0, 0, 0, 0.75)

    const result = selectMatchup(lunches, [])!

    expect(result.map((lunch) => lunch.id)).toEqual([1, 3])
  })

  it('skips anchors with no same-group opponent', () => {
    const lunches = [
      { id: 1, name: 'Only vegan', is_vegan: 1, rating: 1500, glicko_rd: 100 },
      { id: 2, name: 'Non-vegan 1', is_vegan: 0, rating: 1510, glicko_rd: 100 },
      { id: 3, name: 'Non-vegan 2', is_vegan: 0, rating: 1520, glicko_rd: 100 },
    ]
    mockRandom(0, 0, 0.75, 0.75)

    expect(selectMatchup(lunches, [])!.map((lunch) => lunch.id)).toEqual([2, 3])
  })

  it('never returns hard-excluded pairs', () => {
    const lunches = makeLunches(3)

    for (let i = 0; i < 50; i++) {
      const result = selectMatchup(lunches, [], [[1, 2], [1, 3]])!
      expect(result.map((lunch) => lunch.id).sort()).toEqual([2, 3])
    }
  })

  it('returns null when all same-group pairs are hard-excluded', () => {
    const lunches = makeLunches(2)

    expect(selectMatchup(lunches, [], [[1, 2]])).toBeNull()
  })

  it('randomly swaps left and right sides', () => {
    const lunches = makeLunches(2)
    mockRandom(0, 0, 0, 0.25)

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
