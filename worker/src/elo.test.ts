import { describe, it, expect } from 'vitest'
import {
  updateRatingPair,
  conservativeScore,
  confidenceFromRd,
  GLICKO_DEFAULTS,
  computeConsistency,
  consistencyBand,
} from './elo'

const player = () => ({ rating: GLICKO_DEFAULTS.rating, rd: GLICKO_DEFAULTS.rd, volatility: GLICKO_DEFAULTS.volatility })

describe('updateRatingPair', () => {
  it('A wins: A rating increases, B decreases', () => {
    const { a, b } = updateRatingPair({ a: player(), b: player(), outcome: 'A_WIN' })
    expect(a.rating).toBeGreaterThan(1500)
    expect(b.rating).toBeLessThan(1500)
  })

  it('B wins: B rating increases, A decreases', () => {
    const { a, b } = updateRatingPair({ a: player(), b: player(), outcome: 'B_WIN' })
    expect(a.rating).toBeLessThan(1500)
    expect(b.rating).toBeGreaterThan(1500)
  })

  it('Draw at equal ratings: ratings do not change', () => {
    const { a, b } = updateRatingPair({ a: player(), b: player(), outcome: 'DRAW' })
    expect(a.rating).toBeCloseTo(1500, 3)
    expect(b.rating).toBeCloseTo(1500, 3)
  })

  it('Draw at unequal ratings: higher-rated player loses, lower gains', () => {
    const high = { rating: 1700, rd: 100, volatility: 0.06 }
    const low = { rating: 1300, rd: 100, volatility: 0.06 }
    const { a, b } = updateRatingPair({ a: high, b: low, outcome: 'DRAW' })
    expect(a.rating).toBeLessThan(1700)
    expect(b.rating).toBeGreaterThan(1300)
  })

  it('RD decreases after a game (more certain after playing)', () => {
    const { a } = updateRatingPair({ a: player(), b: player(), outcome: 'A_WIN' })
    expect(a.rd).toBeLessThan(GLICKO_DEFAULTS.rd)
  })

  it('Higher-rated player upset loss moves rating more than expected win', () => {
    const strong = { rating: 1700, rd: 100, volatility: 0.06 }
    const weak = { rating: 1300, rd: 100, volatility: 0.06 }
    const { a: upset } = updateRatingPair({ a: strong, b: weak, outcome: 'B_WIN' })
    const { a: expected } = updateRatingPair({ a: strong, b: weak, outcome: 'A_WIN' })
    expect(upset.rating).toBeLessThan(expected.rating)
  })
})

describe('conservativeScore', () => {
  it('returns rating - 2*rd', () => {
    expect(conservativeScore(1500, 350)).toBe(800)
    expect(conservativeScore(1600, 100)).toBe(1400)
  })
})

describe('confidenceFromRd', () => {
  it('returns 100 at floor RD (30)', () => {
    expect(confidenceFromRd(30)).toBe(100)
  })

  it('returns 0 at ceiling RD (350)', () => {
    expect(confidenceFromRd(350)).toBe(0)
  })

  it('returns intermediate value for mid-range RD', () => {
    const mid = confidenceFromRd(190)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
  })
})

describe('computeConsistency', () => {
  it('returns null when there is not enough data', () => {
    expect(computeConsistency(4, 0, 0)).toBeNull()
    expect(computeConsistency(2, 1, 1)).toBeNull()
  })

  it('scores undefeated records as very consistent', () => {
    expect(computeConsistency(6, 0, 0)).toBe(100)
  })

  it('does not score split win-loss records as perfectly consistent', () => {
    expect(computeConsistency(4, 4, 0)).toBe(50)
  })

  it('does not score split win-tie records as perfectly consistent', () => {
    expect(computeConsistency(3, 0, 3)).toBe(50)
  })

  it('scores all ties as consistent neutral results', () => {
    expect(computeConsistency(0, 0, 6)).toBe(100)
  })

  it('returns the dominant outcome share as a 0-100 score', () => {
    expect(computeConsistency(5, 1, 0)).toBeCloseTo(83.3, 1)
    expect(computeConsistency(3, 2, 0)).toBe(60)
  })
})

describe('consistencyBand', () => {
  it('maps consistency scores into display bands', () => {
    expect(consistencyBand(null)).toBeNull()
    expect(consistencyBand(90)).toBe('very-steady')
    expect(consistencyBand(75)).toBe('steady')
    expect(consistencyBand(60)).toBe('mixed')
    expect(consistencyBand(50)).toBe('high-swing')
  })
})
