import { SODA_BAN_HATES, type DrinkStats } from './soda-score'
import {
  addDays,
  buildOrderList,
  ORDER_PARAMS,
  orderParams,
  weekStartFor,
  type OrderItem,
} from './soda-order'

/** SQL: Hate count of drink `alias`.id. Correlated, so a single-drink check seeks idx_soda_reports_soda. */
function hateCountSql(alias: string): string {
  return `(SELECT COUNT(*) FROM soda_reports r WHERE r.soda_id = ${alias}.id AND r.verdict = 'hate')`
}

/** SQL: the Hate count that bans drink `alias`.id: SODA_BAN_HATES, plus the count at an admin unban. */
function banThresholdSql(alias: string): string {
  return `(${SODA_BAN_HATES} + COALESCE((SELECT o.hates_at_override FROM soda_ban_overrides o WHERE o.soda_id = ${alias}.id), 0))`
}

/**
 * SQL condition: drink `alias` is banned. Same rule as isBanned() in soda-score.ts: at least
 * SODA_BAN_HATES distinct voters' latest report is a Hate (soda_reports keeps one row per voter per
 * drink), counted from the Hate count at the last admin unban, if any.
 */
export function bannedSodaSql(alias: string): string {
  return `${hateCountSql(alias)} >= ${banThresholdSql(alias)}`
}

/** SQL condition for a drink that may be shown: active and not banned. `alias` is the sodas alias. */
export function shownSodaSql(alias: string): string {
  return `${alias}.is_active = 1 AND NOT (${bannedSodaSql(alias)})`
}

/** True when an active drink is banned (for a clear 409 instead of a 404). */
export async function isSodaBanned(db: D1Database, sodaId: number): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS hit FROM sodas s WHERE s.id = ? AND s.is_active = 1 AND ${bannedSodaSql('s')}`
  ).bind(sodaId).first<{ hit: number }>()
  return row !== null
}

/**
 * Per-drink counts for every active drink, BANNED ONES INCLUDED, plus each drink's unban offset.
 * Always pass these to scoreDrinks (feed, leaderboard, weekly order): it leaves banned drinks out of
 * its output and the type mean, and keeps their evidence in their brand's prior.
 * Swipes and reports both keep one row per voter per drink (latest wins on write).
 */
export const DRINK_STATS_SQL = `
  SELECT
    s.id, s.brand, s.flavor, s.type, s.image_key,
    COALESCE(sw.right_swipes, 0) AS right_swipes,
    COALESCE(sw.left_swipes, 0) AS left_swipes,
    COALESCE(rp.likes, 0) AS likes,
    COALESCE(rp.hates, 0) AS hates,
    COALESCE(rp.reporters, 0) AS reporters,
    COALESCE(o.hates_at_override, 0) AS ban_offset
  FROM sodas s
  LEFT JOIN (
    SELECT soda_id,
      SUM(CASE WHEN direction = 'right' THEN 1 ELSE 0 END) AS right_swipes,
      SUM(CASE WHEN direction = 'left' THEN 1 ELSE 0 END) AS left_swipes
    FROM soda_swipes
    GROUP BY soda_id
  ) sw ON sw.soda_id = s.id
  LEFT JOIN (
    SELECT soda_id,
      SUM(CASE WHEN verdict = 'like' THEN 1 ELSE 0 END) AS likes,
      SUM(CASE WHEN verdict = 'hate' THEN 1 ELSE 0 END) AS hates,
      COUNT(*) AS reporters
    FROM soda_reports
    GROUP BY soda_id
  ) rp ON rp.soda_id = s.id
  LEFT JOIN soda_ban_overrides o ON o.soda_id = s.id
  WHERE s.is_active = 1
`

/**
 * Every active drink with counts, banned ones included (see DRINK_STATS_SQL). Not a list of drinks
 * to show: scoreDrinks decides that.
 */
export async function loadScoringStats(db: D1Database): Promise<DrinkStats[]> {
  const result = await db.prepare(DRINK_STATS_SQL).all<DrinkStats>()
  return result.results
}

export function imageUrl(imageKey: string | null): string | null {
  return imageKey ? `/api/images/${imageKey}` : null
}

export type BuyListRow = {
  week_start: string
  generated_at: string
  items_json: string
  params_json: string
}

async function loadRecentTrialIds(db: D1Database, weekStart: string): Promise<number[]> {
  const since = addDays(weekStart, -7 * ORDER_PARAMS.trialCooldownWeeks)
  const rows = await db.prepare(
    'SELECT items_json FROM soda_buy_lists WHERE week_start >= ? AND week_start < ?'
  ).bind(since, weekStart).all<{ items_json: string }>()
  const ids = new Set<number>()
  for (const row of rows.results) {
    for (const item of JSON.parse(row.items_json) as OrderItem[]) {
      if (item.slot === 'trial') ids.add(item.soda_id)
    }
  }
  return [...ids].sort((a, b) => a - b)
}

/**
 * Computes this week's order list and stores it.
 * mode 'keep' uses INSERT OR IGNORE, so a repeat cron firing leaves the frozen snapshot alone.
 * mode 'replace' overwrites the current week (admin regenerate).
 */
export async function writeWeeklyOrder(
  db: D1Database,
  now: Date,
  mode: 'keep' | 'replace'
): Promise<string> {
  const weekStart = weekStartFor(now)
  const [drinks, recentTrialIds] = await Promise.all([
    loadScoringStats(db),
    loadRecentTrialIds(db, weekStart),
  ])
  const items = buildOrderList(drinks, { seed: weekStart, recentTrialIds })
  const verb = mode === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE'
  await db.prepare(
    `${verb} INTO soda_buy_lists (week_start, generated_at, items_json, params_json) VALUES (?, ?, ?, ?)`
  ).bind(
    weekStart,
    now.toISOString(),
    JSON.stringify(items),
    JSON.stringify(orderParams(weekStart, recentTrialIds))
  ).run()
  return weekStart
}
