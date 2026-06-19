import { describe, it, expect } from 'vitest'
import { calculateElo } from './elo'

describe('calculateElo', () => {
  it('A wins: A rating increases, B decreases', () => {
    const { newA, newB } = calculateElo(1000, 1000, 'a_wins')
    expect(newA).toBeGreaterThan(1000)
    expect(newB).toBeLessThan(1000)
  })

  it('B wins: B rating increases, A decreases', () => {
    const { newA, newB } = calculateElo(1000, 1000, 'b_wins')
    expect(newA).toBeLessThan(1000)
    expect(newB).toBeGreaterThan(1000)
  })

  it('Tie: both ratings move toward each other from equal start — no change', () => {
    const { newA, newB } = calculateElo(1000, 1000, 'tie')
    expect(newA).toBeCloseTo(1000, 5)
    expect(newB).toBeCloseTo(1000, 5)
  })

  it('Equal ratings + A wins: A gains exactly 16 points', () => {
    const { newA, newB } = calculateElo(1000, 1000, 'a_wins')
    expect(newA).toBeCloseTo(1016, 5)
    expect(newB).toBeCloseTo(984, 5)
  })

  it('Higher-rated player losing: larger rating drop than equal-rated loss', () => {
    // A is much higher rated than B, A loses — A should lose more than 16 points
    const { newA } = calculateElo(1400, 1000, 'b_wins')
    const { newA: equalLoss } = calculateElo(1000, 1000, 'b_wins')
    expect(Math.abs(1400 - newA)).toBeGreaterThan(Math.abs(1000 - equalLoss))
  })

  it('Sum of ratings is conserved', () => {
    const total = 2000
    const { newA: wA, newB: wB } = calculateElo(1000, 1000, 'a_wins')
    expect(wA + wB).toBeCloseTo(total, 5)
    const { newA: tA, newB: tB } = calculateElo(1000, 1000, 'tie')
    expect(tA + tB).toBeCloseTo(total, 5)
    const { newA: lA, newB: lB } = calculateElo(1000, 1000, 'b_wins')
    expect(lA + lB).toBeCloseTo(total, 5)
  })

  it('Tie at unequal ratings: higher-rated player loses a small amount', () => {
    const { newA, newB } = calculateElo(1200, 1000, 'tie')
    expect(newA).toBeLessThan(1200) // favored player loses a bit
    expect(newB).toBeGreaterThan(1000) // underdog gains a bit
  })
})
