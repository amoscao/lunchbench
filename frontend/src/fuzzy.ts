export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function similarity(a: string, b: string): number {
  const la = a.toLowerCase().trim()
  const lb = b.toLowerCase().trim()
  if (la === lb) return 1
  if (la.length === 0 || lb.length === 0) return 0
  const longer = Math.max(la.length, lb.length)
  return (longer - editDistance(la, lb)) / longer
}

export function findSimilar(
  input: string,
  candidates: { id: number; name: string }[],
  threshold = 0.6
): Array<{ id: number; name: string; score: number }> {
  if (!input.trim()) return []
  return candidates
    .map((c) => ({ ...c, score: similarity(input, c.name) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

export function fuzzyFilter(
  query: string,
  candidates: { id: number; name: string }[]
): Array<{ id: number; name: string }> {
  if (!query.trim()) return candidates
  const q = query.toLowerCase()
  return candidates
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) || similarity(q, c.name) > 0.4
    )
    .sort((a, b) => {
      const aIncl = a.name.toLowerCase().includes(q) ? 1 : 0
      const bIncl = b.name.toLowerCase().includes(q) ? 1 : 0
      if (aIncl !== bIncl) return bIncl - aIncl
      return similarity(q, b.name) - similarity(q, a.name)
    })
    .slice(0, 10)
}
