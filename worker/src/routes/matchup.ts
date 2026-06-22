import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow } from '../helpers'
import { selectMatchup } from '../matchup'
import type { LunchRow } from '../types'
import { conservativeScore, updateRatingPair } from '../elo'
import { checkRateLimit, getClientIp } from '../rate-limit'

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

function rankWithHeadToHead(rankRow: RankRow | null, score: number, otherScore: number): number {
  return (rankRow?.rank ?? 1) + (otherScore > score ? 1 : 0)
}

matchup.get('/', async (c) => {
  const ip = getClientIp(c.req.raw)
  const veganOnly = c.req.query('vegan') === 'true'
  const query = veganOnly
    ? 'SELECT * FROM lunches WHERE is_vegan = 1'
    : 'SELECT * FROM lunches WHERE is_vegan = 0'
  const [rl, allLunches, recentVotes] = await Promise.all([
    checkRateLimit(c.env.DB, ip, 'matchup', 2000, 3600),
    c.env.DB.prepare(query).all<LunchRow>(),
    c.env.DB.prepare(
      // id DESC makes same-second D1 timestamps deterministic.
      'SELECT left_lunch_id, right_lunch_id FROM votes ORDER BY created_at DESC, id DESC LIMIT 10'
    ).all<{ left_lunch_id: number; right_lunch_id: number }>(),
  ])
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rl.retryAfter ?? 3600) }
    )
  }

  const recentPairs: [number, number][] = recentVotes.results.map(
    (v) => [v.left_lunch_id, v.right_lunch_id]
  )

  const pair = selectMatchup(allLunches.results, recentPairs)
  if (!pair) return c.body(null, 204, { 'Cache-Control': 'no-store' })

  const pairIsVegan = pair[0].is_vegan
  const leftWin = projectOutcome(pair[0], pair[1], 'A_WIN')
  const rightWin = projectOutcome(pair[0], pair[1], 'B_WIN')
  const tie = projectOutcome(pair[0], pair[1], 'DRAW')
  const [leftId, rightId] = [pair[0].id, pair[1].id]
  const [
    leftRankRow,
    rightRankRow,
    leftWinLeftRank,
    leftWinRightRank,
    rightWinLeftRank,
    rightWinRightRank,
    tieLeftRank,
    tieRightRank,
  ] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, pair[0].conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, pair[1].conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, leftWin.left.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, leftWin.right.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, rightWin.left.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, rightWin.right.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, tie.left.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM lunches WHERE is_vegan = ? AND id NOT IN (?, ?) AND conservative_rating > ?'
    )
      .bind(pairIsVegan, leftId, rightId, tie.right.conservative_rating)
      .first<RankRow>(),
  ])

  const leftRank = rankWithHeadToHead(
    leftRankRow,
    pair[0].conservative_rating,
    pair[1].conservative_rating
  )
  const rightRank = rankWithHeadToHead(
    rightRankRow,
    pair[1].conservative_rating,
    pair[0].conservative_rating
  )

  return c.json(
    {
      left: {
        ...lunchFromRow(pair[0]),
        rank: leftRank,
      },
      right: {
        ...lunchFromRow(pair[1]),
        rank: rightRank,
      },
      projected: {
        left_win: {
          left: {
            ...leftWin.left,
            rank: rankWithHeadToHead(
              leftWinLeftRank,
              leftWin.left.conservative_rating,
              leftWin.right.conservative_rating
            ),
          },
          right: {
            ...leftWin.right,
            rank: rankWithHeadToHead(
              leftWinRightRank,
              leftWin.right.conservative_rating,
              leftWin.left.conservative_rating
            ),
          },
        },
        right_win: {
          left: {
            ...rightWin.left,
            rank: rankWithHeadToHead(
              rightWinLeftRank,
              rightWin.left.conservative_rating,
              rightWin.right.conservative_rating
            ),
          },
          right: {
            ...rightWin.right,
            rank: rankWithHeadToHead(
              rightWinRightRank,
              rightWin.right.conservative_rating,
              rightWin.left.conservative_rating
            ),
          },
        },
        tie: {
          left: {
            ...tie.left,
            rank: rankWithHeadToHead(
              tieLeftRank,
              tie.left.conservative_rating,
              tie.right.conservative_rating
            ),
          },
          right: {
            ...tie.right,
            rank: rankWithHeadToHead(
              tieRightRank,
              tie.right.conservative_rating,
              tie.left.conservative_rating
            ),
          },
        },
      },
    },
    200,
    { 'Cache-Control': 'no-store' }
  )
})

export { matchup as matchupRouter }
