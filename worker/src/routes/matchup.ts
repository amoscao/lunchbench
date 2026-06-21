import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow } from '../helpers'
import { selectMatchup } from '../matchup'
import type { LunchRow } from '../types'
import { conservativeScore, updateRatingPair } from '../elo'

const matchup = new Hono<{ Bindings: Bindings }>()

type RankRow = {
  rank: number
}

type ProjectedResult = {
  rating: number
  conservative_rating: number
  rank: number
}

function projectOutcome(
  left: LunchRow,
  right: LunchRow,
  outcome: 'A_WIN' | 'B_WIN' | 'DRAW'
): { left: Omit<ProjectedResult, 'rank'>; right: Omit<ProjectedResult, 'rank'> } {
  const updated = updateRatingPair({
    a: { rating: left.rating, rd: left.glicko_rd, volatility: left.glicko_volatility },
    b: { rating: right.rating, rd: right.glicko_rd, volatility: right.glicko_volatility },
    outcome,
  })

  return {
    left: {
      rating: updated.a.rating,
      conservative_rating: conservativeScore(updated.a.rating, updated.a.rd),
    },
    right: {
      rating: updated.b.rating,
      conservative_rating: conservativeScore(updated.b.rating, updated.b.rd),
    },
  }
}

matchup.get('/', async (c) => {
  const veganOnly = c.req.query('vegan') === 'true'
  const query = veganOnly
    ? 'SELECT * FROM lunches WHERE is_vegan = 1'
    : 'SELECT * FROM lunches'
  const allLunches = await c.env.DB.prepare(query).all<LunchRow>()
  const recentVotes = await c.env.DB.prepare(
    // id DESC makes same-second D1 timestamps deterministic.
    'SELECT left_lunch_id, right_lunch_id FROM votes ORDER BY created_at DESC, id DESC LIMIT 10'
  ).all<{ left_lunch_id: number; right_lunch_id: number }>()

  const recentPairs: [number, number][] = recentVotes.results.map(
    (v) => [v.left_lunch_id, v.right_lunch_id]
  )

  const pair = selectMatchup(allLunches.results, recentPairs)
  if (!pair) return c.body(null, 204, { 'Cache-Control': 'no-store' })

  const baseUrl = new URL(c.req.url).origin
  const leftWin = projectOutcome(pair[0], pair[1], 'A_WIN')
  const rightWin = projectOutcome(pair[0], pair[1], 'B_WIN')
  const tie = projectOutcome(pair[0], pair[1], 'DRAW')

  const [leftRankRow, rightRankRow] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(pair[0].conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(pair[1].conservative_rating)
      .first<RankRow>(),
  ])
  const [
    leftWinLeftRank,
    leftWinRightRank,
    rightWinLeftRank,
    rightWinRightRank,
    tieLeftRank,
    tieRightRank,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(leftWin.left.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(leftWin.right.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(rightWin.left.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(rightWin.right.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(tie.left.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(tie.right.conservative_rating)
      .first<RankRow>(),
  ])

  return c.json(
    {
      left: {
        ...lunchFromRow(pair[0], baseUrl),
        rank: leftRankRow?.rank ?? 1,
      },
      right: {
        ...lunchFromRow(pair[1], baseUrl),
        rank: rightRankRow?.rank ?? 1,
      },
      projected: {
        left_win: {
          left: { ...leftWin.left, rank: leftWinLeftRank?.rank ?? 1 },
          right: { ...leftWin.right, rank: leftWinRightRank?.rank ?? 1 },
        },
        right_win: {
          left: { ...rightWin.left, rank: rightWinLeftRank?.rank ?? 1 },
          right: { ...rightWin.right, rank: rightWinRightRank?.rank ?? 1 },
        },
        tie: {
          left: { ...tie.left, rank: tieLeftRank?.rank ?? 1 },
          right: { ...tie.right, rank: tieRightRank?.rank ?? 1 },
        },
      },
    },
    200,
    { 'Cache-Control': 'no-store' }
  )
})

export { matchup as matchupRouter }
