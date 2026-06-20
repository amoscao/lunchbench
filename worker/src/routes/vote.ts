import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow } from '../helpers'
import { checkRateLimit, getClientIp } from '../rate-limit'
import { calculateElo } from '../elo'
import { selectMatchup } from '../matchup'
import type { LunchRow } from '../types'

const vote = new Hono<{ Bindings: Bindings }>()

vote.post('/', async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env.DB, ip, 'vote', 300, 3600)
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(rl.retryAfter ?? 3600) }
    )
  }

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
    result: 'left_win' | 'right_win' | 'tie'
  }

  const [leftRow, rightRow] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM lunches WHERE id = ?').bind(left_lunch_id).first<LunchRow>(),
    c.env.DB.prepare('SELECT * FROM lunches WHERE id = ?').bind(right_lunch_id).first<LunchRow>(),
  ])

  if (!leftRow || !rightRow) {
    return c.json({ error: 'Lunch not found', code: 'NOT_FOUND' }, 404)
  }

  const eloResult = result === 'left_win' ? 'a_wins' : result === 'right_win' ? 'b_wins' : 'tie'
  const { newA: newLeft, newB: newRight } = calculateElo(leftRow.rating, rightRow.rating, eloResult)

  const leftWins = result === 'left_win' ? leftRow.wins + 1 : leftRow.wins
  const leftLosses = result === 'right_win' ? leftRow.losses + 1 : leftRow.losses
  const leftTies = result === 'tie' ? leftRow.ties + 1 : leftRow.ties

  const rightWins = result === 'right_win' ? rightRow.wins + 1 : rightRow.wins
  const rightLosses = result === 'left_win' ? rightRow.losses + 1 : rightRow.losses
  const rightTies = result === 'tie' ? rightRow.ties + 1 : rightRow.ties

  const now = new Date().toISOString()

  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE lunches SET rating = ?, wins = ?, losses = ?, ties = ?, updated_at = ? WHERE id = ?'
    ).bind(newLeft, leftWins, leftLosses, leftTies, now, left_lunch_id),
    c.env.DB.prepare(
      'UPDATE lunches SET rating = ?, wins = ?, losses = ?, ties = ?, updated_at = ? WHERE id = ?'
    ).bind(newRight, rightWins, rightLosses, rightTies, now, right_lunch_id),
    c.env.DB.prepare(
      `INSERT INTO votes (left_lunch_id, right_lunch_id, result, left_rating_before, right_rating_before, left_rating_after, right_rating_after, voter_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      left_lunch_id, right_lunch_id, result,
      leftRow.rating, rightRow.rating,
      newLeft, newRight,
      ip
    ),
  ])

  const voteRow = await c.env.DB.prepare(
    'SELECT id FROM votes ORDER BY id DESC LIMIT 1'
  ).first<{ id: number }>()

  // Get next matchup
  const allLunches = await c.env.DB.prepare('SELECT * FROM lunches').all<LunchRow>()
  const recentVotes = await c.env.DB.prepare(
    'SELECT left_lunch_id, right_lunch_id FROM votes ORDER BY created_at DESC LIMIT 10'
  ).all<{ left_lunch_id: number; right_lunch_id: number }>()

  const recentPairs: [number, number][] = recentVotes.results.map(
    (v) => [v.left_lunch_id, v.right_lunch_id]
  )

  const nextPair = selectMatchup(allLunches.results, recentPairs)
  const baseUrl = new URL(c.req.url).origin

  return c.json({
    vote_id: voteRow?.id ?? null,
    next: nextPair
      ? { left: lunchFromRow(nextPair[0], baseUrl), right: lunchFromRow(nextPair[1], baseUrl) }
      : null,
  })
})

export { vote as voteRouter }
