import { Hono } from 'hono'
import type { Bindings } from '../types'
import { lunchFromRow } from '../helpers'
import { selectMatchup } from '../matchup'
import type { LunchRow } from '../types'

const matchup = new Hono<{ Bindings: Bindings }>()

type RankRow = {
  rank: number
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
  const [leftRankRow, rightRankRow] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(pair[0].conservative_rating)
      .first<RankRow>(),
    c.env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM lunches WHERE conservative_rating > ?')
      .bind(pair[1].conservative_rating)
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
    },
    200,
    { 'Cache-Control': 'no-store' }
  )
})

export { matchup as matchupRouter }
