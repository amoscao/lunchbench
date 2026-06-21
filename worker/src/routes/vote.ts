import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow } from '../helpers'
import { checkCooldown, checkRateLimit, clearRateLimit, getClientIp } from '../rate-limit'
import { conservativeScore, updateRatingPair } from '../elo'
import { selectMatchup } from '../matchup'
import type { LunchRow } from '../types'

const vote = new Hono<{ Bindings: Bindings }>()
export const MAX_VOTE_WRITE_ATTEMPTS = 10
export const VOTE_RATE_LIMIT_PER_HOUR = 30
export const VOTE_PAIR_COOLDOWN_SECONDS = 24 * 60 * 60

type VoteResult = 'left_win' | 'right_win' | 'tie'
type VoteWriteResult =
  | { status: 'ok'; voteId: number }
  | { status: 'not_found' }
  | { status: 'conflict' }

function uniqueIsoTimestamp(): string {
  const suffix = Math.floor(Math.random() * 100000000).toString().padStart(8, '0')
  return new Date().toISOString().replace('Z', `${suffix}Z`)
}

export async function getVotePairRateLimitKey(
  ip: string,
  leftLunchId: number,
  rightLunchId: number
): Promise<string> {
  const [minId, maxId] = [leftLunchId, rightLunchId].sort((a, b) => a - b)
  const ipBytes = new TextEncoder().encode(ip)
  const ipDigest = await crypto.subtle.digest('SHA-256', ipBytes)
  const ipHash = Array.from(new Uint8Array(ipDigest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return `vote_pair_${ipHash}_${minId}_${maxId}`
}

export async function recordVoteWithRetry(
  db: D1Database,
  left_lunch_id: number,
  right_lunch_id: number,
  result: VoteResult,
  voterKey: string
): Promise<VoteWriteResult> {
  let voteId: number | null = null

  for (let attempt = 0; attempt < MAX_VOTE_WRITE_ATTEMPTS && voteId === null; attempt++) {
    const [leftRow, rightRow] = await Promise.all([
      db.prepare('SELECT * FROM lunches WHERE id = ?').bind(left_lunch_id).first<LunchRow>(),
      db.prepare('SELECT * FROM lunches WHERE id = ?').bind(right_lunch_id).first<LunchRow>(),
    ])

    if (!leftRow || !rightRow) {
      return { status: 'not_found' }
    }

    const outcome = result === 'left_win' ? 'A_WIN' : result === 'right_win' ? 'B_WIN' : 'DRAW'
    const updated = updateRatingPair({
      a: { rating: leftRow.rating, rd: leftRow.glicko_rd, volatility: leftRow.glicko_volatility },
      b: { rating: rightRow.rating, rd: rightRow.glicko_rd, volatility: rightRow.glicko_volatility },
      outcome,
    })
    const newLeft = updated.a
    const newRight = updated.b
    const newLeftConservative = conservativeScore(newLeft.rating, newLeft.rd)
    const newRightConservative = conservativeScore(newRight.rating, newRight.rd)

    const leftWinIncrement = result === 'left_win' ? 1 : 0
    const leftLossIncrement = result === 'right_win' ? 1 : 0
    const leftTieIncrement = result === 'tie' ? 1 : 0

    const rightWinIncrement = result === 'right_win' ? 1 : 0
    const rightLossIncrement = result === 'left_win' ? 1 : 0
    const rightTieIncrement = result === 'tie' ? 1 : 0

    const now = uniqueIsoTimestamp()

    // D1 batch is transactional. The guarded update only touches both rows if
    // both still match the rating snapshot used for this Glicko update. The
    // insert is tied to this update's unique timestamp, so stale attempts do
    // not create vote rows.
    const writeResults = await db.batch([
      db.prepare(
        `UPDATE lunches
         SET
          rating = CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE rating END,
          glicko_rd = CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE glicko_rd END,
          glicko_volatility = CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE glicko_volatility END,
          conservative_rating = CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE conservative_rating END,
          wins = wins + CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE 0 END,
          losses = losses + CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE 0 END,
          ties = ties + CASE id WHEN ? THEN ? WHEN ? THEN ? ELSE 0 END,
          updated_at = ?
         WHERE id IN (?, ?)
          AND EXISTS (
            SELECT 1 FROM lunches
            WHERE id = ?
              AND rating = ?
              AND glicko_rd = ?
              AND glicko_volatility = ?
              AND conservative_rating = ?
          )
          AND EXISTS (
            SELECT 1 FROM lunches
            WHERE id = ?
              AND rating = ?
              AND glicko_rd = ?
              AND glicko_volatility = ?
              AND conservative_rating = ?
          )
         RETURNING id`
      ).bind(
        left_lunch_id, newLeft.rating, right_lunch_id, newRight.rating,
        left_lunch_id, newLeft.rd, right_lunch_id, newRight.rd,
        left_lunch_id, newLeft.volatility, right_lunch_id, newRight.volatility,
        left_lunch_id, newLeftConservative, right_lunch_id, newRightConservative,
        left_lunch_id, leftWinIncrement, right_lunch_id, rightWinIncrement,
        left_lunch_id, leftLossIncrement, right_lunch_id, rightLossIncrement,
        left_lunch_id, leftTieIncrement, right_lunch_id, rightTieIncrement,
        now,
        left_lunch_id, right_lunch_id,
        left_lunch_id,
        leftRow.rating,
        leftRow.glicko_rd,
        leftRow.glicko_volatility,
        leftRow.conservative_rating,
        right_lunch_id,
        rightRow.rating,
        rightRow.glicko_rd,
        rightRow.glicko_volatility,
        rightRow.conservative_rating
      ),
      db.prepare(
        `INSERT INTO votes (
          left_lunch_id,
          right_lunch_id,
          result,
          left_rating_before,
          right_rating_before,
          left_rating_after,
          right_rating_after,
          voter_key
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE
          (SELECT updated_at FROM lunches WHERE id = ?) = ?
          AND (SELECT updated_at FROM lunches WHERE id = ?) = ?
        RETURNING id`
      ).bind(
        left_lunch_id,
        right_lunch_id,
        result,
        leftRow.rating,
        rightRow.rating,
        newLeft.rating,
        newRight.rating,
        voterKey,
        left_lunch_id,
        now,
        right_lunch_id,
        now
      ),
    ])

    const voteRow = writeResults[1]?.results?.[0] as { id: number } | undefined
    voteId = voteRow?.id ?? null
  }

  return voteId === null ? { status: 'conflict' } : { status: 'ok', voteId }
}

type VoteResultRow = {
  rating: number
  conservative_rating: number
}

type RankRow = {
  rank: number
}

vote.post('/', async (c) => {
  const ip = getClientIp(c.req.raw)

  const body: {
    left_lunch_id?: number
    right_lunch_id?: number
    result?: string
  } = await c.req.json<{
    left_lunch_id?: number
    right_lunch_id?: number
    result?: string
  }>().catch(() => ({}))

  if (
    typeof body.left_lunch_id !== 'number' ||
    typeof body.right_lunch_id !== 'number' ||
    !['left_win', 'right_win', 'tie'].includes(body.result ?? '')
  ) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400)
  }

  const { left_lunch_id, right_lunch_id, result } = body as {
    left_lunch_id: number
    right_lunch_id: number
    result: VoteResult
  }

  if (left_lunch_id === right_lunch_id) {
    return c.json({ error: 'Lunches must be different', code: 'BAD_REQUEST' }, 400)
  }

  const rl = await checkRateLimit(c.env.DB, ip, 'vote', VOTE_RATE_LIMIT_PER_HOUR, 3600)
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rl.retryAfter ?? 3600) }
    )
  }

  const pairRateLimitKey = await getVotePairRateLimitKey(ip, left_lunch_id, right_lunch_id)
  const pairRl = await checkCooldown(
    c.env.DB,
    pairRateLimitKey,
    'vote_pair',
    VOTE_PAIR_COOLDOWN_SECONDS
  )
  if (!pairRl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(pairRl.retryAfter ?? VOTE_PAIR_COOLDOWN_SECONDS) }
    )
  }

  const writeResult = await recordVoteWithRetry(c.env.DB, left_lunch_id, right_lunch_id, result, ip)
  if (writeResult.status === 'not_found') {
    await clearRateLimit(c.env.DB, pairRateLimitKey, 'vote_pair')
    return c.json({ error: 'Lunch not found', code: 'NOT_FOUND' }, 404)
  }
  if (writeResult.status === 'conflict') {
    await clearRateLimit(c.env.DB, pairRateLimitKey, 'vote_pair')
    return c.json({ error: 'Vote conflict, please retry', code: 'CONFLICT' }, 409)
  }

  const [leftResultRow, rightResultRow] = await Promise.all([
    c.env.DB.prepare('SELECT rating, conservative_rating FROM lunches WHERE id = ?')
      .bind(left_lunch_id)
      .first<VoteResultRow>(),
    c.env.DB.prepare('SELECT rating, conservative_rating FROM lunches WHERE id = ?')
      .bind(right_lunch_id)
      .first<VoteResultRow>(),
  ])

  if (!leftResultRow || !rightResultRow) {
    return c.json({ error: 'Lunch not found', code: 'NOT_FOUND' }, 404)
  }

  const [leftRankRow, rightRankRow] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(leftResultRow.conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(rightResultRow.conservative_rating)
      .first<RankRow>(),
  ])

  // Get next matchup
  const allLunches = await c.env.DB.prepare('SELECT * FROM lunches').all<LunchRow>()
  const recentVotes = await c.env.DB.prepare(
    // id DESC makes same-second D1 timestamps deterministic.
    'SELECT left_lunch_id, right_lunch_id FROM votes ORDER BY created_at DESC, id DESC LIMIT 10'
  ).all<{ left_lunch_id: number; right_lunch_id: number }>()

  const recentPairs: [number, number][] = recentVotes.results.map(
    (v) => [v.left_lunch_id, v.right_lunch_id]
  )

  const nextPair = selectMatchup(allLunches.results, recentPairs)
  const baseUrl = new URL(c.req.url).origin
  const next = nextPair
    ? await Promise.all([
        c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
          .bind(nextPair[0].conservative_rating)
          .first<RankRow>(),
        c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
          .bind(nextPair[1].conservative_rating)
          .first<RankRow>(),
      ]).then(([nextLeftRankRow, nextRightRankRow]) => ({
        left: {
          ...lunchFromRow(nextPair[0], baseUrl),
          rank: nextLeftRankRow?.rank ?? 1,
        },
        right: {
          ...lunchFromRow(nextPair[1], baseUrl),
          rank: nextRightRankRow?.rank ?? 1,
        },
      }))
    : null

  return c.json({
    vote_id: writeResult.voteId,
    left_result: {
      rating: leftResultRow.rating,
      conservative_rating: leftResultRow.conservative_rating,
      rank: leftRankRow?.rank ?? 1,
    },
    right_result: {
      rating: rightResultRow.rating,
      conservative_rating: rightResultRow.conservative_rating,
      rank: rightRankRow?.rank ?? 1,
    },
    next,
  })
})

export { vote as voteRouter }
