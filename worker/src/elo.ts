export type EloResult = 'a_wins' | 'b_wins' | 'tie'

const K = 32

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

export function calculateElo(
  ratingA: number,
  ratingB: number,
  result: EloResult
): { newA: number; newB: number } {
  const eA = expectedScore(ratingA, ratingB)
  const eB = expectedScore(ratingB, ratingA)

  const sA = result === 'a_wins' ? 1 : result === 'b_wins' ? 0 : 0.5
  const sB = 1 - sA

  return {
    newA: ratingA + K * (sA - eA),
    newB: ratingB + K * (sB - eB),
  }
}
