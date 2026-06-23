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

type PresentedPairRow = {
  low_lunch_id: number
  high_lunch_id: number
}

type MatchupTokenRow = PresentedPairRow & {
  session_key: string
  vegan_only: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseSessionKey(value: string | null): string | null {
  if (!value) return null
  const sessionKey = value.trim()
  return UUID_RE.test(sessionKey) ? sessionKey : null
}

function orderedPairIds(leftId: number, rightId: number): [number, number] {
  return leftId < rightId ? [leftId, rightId] : [rightId, leftId]
}

async function upsertMatchupSession(db: D1Database, sessionKey: string): Promise<void> {
  await db.prepare(
    `INSERT INTO matchup_sessions (session_key)
     VALUES (?)
     ON CONFLICT(session_key) DO UPDATE SET last_seen_at = datetime('now')`
  ).bind(sessionKey).run()
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
  const veganFlag = veganOnly ? 1 : 0
  const sessionKey = parseSessionKey(c.req.header('X-Lunchbench-Session') ?? null)
  if (sessionKey) await upsertMatchupSession(c.env.DB, sessionKey)

  const query = veganOnly
    ? 'SELECT * FROM lunches WHERE is_vegan = 1'
    : 'SELECT * FROM lunches WHERE is_vegan = 0'
  const [rl, allLunches, recentVotes, seenPairsResult] = await Promise.all([
    checkRateLimit(c.env.DB, ip, 'matchup', 2000, 3600),
    c.env.DB.prepare(query).all<LunchRow>(),
    c.env.DB.prepare(
      // id DESC makes same-second D1 timestamps deterministic.
      'SELECT left_lunch_id, right_lunch_id FROM votes ORDER BY created_at DESC, id DESC LIMIT 10'
    ).all<{ left_lunch_id: number; right_lunch_id: number }>(),
    sessionKey
      ? c.env.DB.prepare(
        `SELECT low_lunch_id, high_lunch_id
         FROM matchup_presentations
         WHERE session_key = ? AND vegan_only = ?`
      ).bind(sessionKey, veganFlag).all<PresentedPairRow>()
      : Promise.resolve({ results: [] as PresentedPairRow[] }),
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
  const seenPairs: [number, number][] = seenPairsResult.results.map(
    (p) => [p.low_lunch_id, p.high_lunch_id]
  )

  if (allLunches.results.length < 2) {
    return c.body(null, 204, { 'Cache-Control': 'no-store' })
  }

  const pair = selectMatchup(allLunches.results, recentPairs, seenPairs)
  if (!pair) {
    return c.json({ status: 'exhausted' }, 200, { 'Cache-Control': 'no-store' })
  }

  const pairIsVegan = pair[0].is_vegan
  const leftWin = projectOutcome(pair[0], pair[1], 'A_WIN')
  const rightWin = projectOutcome(pair[0], pair[1], 'B_WIN')
  const tie = projectOutcome(pair[0], pair[1], 'DRAW')
  const [leftId, rightId] = [pair[0].id, pair[1].id]
  const [lowLunchId, highLunchId] = orderedPairIds(leftId, rightId)
  const matchupToken = crypto.randomUUID()
  const tokenSessionKey = sessionKey ?? crypto.randomUUID()
  if (!sessionKey) await upsertMatchupSession(c.env.DB, tokenSessionKey)
  await c.env.DB.prepare(
    `INSERT INTO matchup_tokens (token, session_key, vegan_only, low_lunch_id, high_lunch_id)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(matchupToken, tokenSessionKey, veganFlag, lowLunchId, highLunchId).run()

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
      status: 'ok',
      matchup_token: matchupToken,
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

matchup.post('/seen', async (c) => {
  let body: { token?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid token', code: 'BAD_REQUEST' }, 400)
  }

  if (typeof body.token !== 'string' || body.token.length === 0) {
    return c.json({ error: 'Invalid token', code: 'BAD_REQUEST' }, 400)
  }

  const tokenRow = await c.env.DB.prepare(
    `SELECT session_key, vegan_only, low_lunch_id, high_lunch_id
     FROM matchup_tokens
     WHERE token = ?`
  ).bind(body.token).first<MatchupTokenRow>()

  if (!tokenRow) {
    return c.json({ error: 'Invalid token', code: 'BAD_REQUEST' }, 400)
  }

  await upsertMatchupSession(c.env.DB, tokenRow.session_key)
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO matchup_presentations
       (session_key, vegan_only, low_lunch_id, high_lunch_id)
     VALUES (?, ?, ?, ?)`
  ).bind(
    tokenRow.session_key,
    tokenRow.vegan_only,
    tokenRow.low_lunch_id,
    tokenRow.high_lunch_id
  ).run()

  return c.json({ ok: true })
})

export { matchup as matchupRouter }
