import { SODA_BAN_HATES, type DrinkStats } from './soda-score'
import {
  addDays,
  buildOrderList,
  ORDER_PARAMS,
  orderParams,
  weekStartFor,
  type OrderItem,
} from './soda-order'

/**
 * Ids of banned drinks: at least SODA_BAN_HATES distinct voters' latest report is a Hate
 * (soda_reports keeps one row per voter per drink). Same rule as isBanned() in soda-score.ts.
 */
export const BANNED_SODA_IDS_SQL =
  `SELECT soda_id FROM soda_reports WHERE verdict = 'hate' GROUP BY soda_id HAVING COUNT(*) >= ${SODA_BAN_HATES}`

/** SQL condition for a drink that may be shown: active and not banned. `alias` is the sodas alias. */
export function shownSodaSql(alias: string): string {
  return `${alias}.is_active = 1 AND ${alias}.id NOT IN (${BANNED_SODA_IDS_SQL})`
}

/** True when an active drink is banned (for a clear 409 instead of a 404). */
export async function isSodaBanned(db: D1Database, sodaId: number): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS hit FROM sodas WHERE id = ? AND is_active = 1 AND id IN (${BANNED_SODA_IDS_SQL})`
  ).bind(sodaId).first<{ hit: number }>()
  return row !== null
}

/**
 * Per-drink counts for every active drink, banned ones included (scoring needs their evidence for
 * the brand prior; scoreDrinks and the feed leave them out).
 * Swipes and reports both keep one row per voter per drink (latest wins on write).
 */
export const DRINK_STATS_SQL = `
  SELECT
    s.id, s.brand, s.flavor, s.type, s.image_key,
    COALESCE(sw.right_swipes, 0) AS right_swipes,
    COALESCE(sw.left_swipes, 0) AS left_swipes,
    COALESCE(rp.likes, 0) AS likes,
    COALESCE(rp.hates, 0) AS hates,
    COALESCE(rp.reporters, 0) AS reporters
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
  WHERE s.is_active = 1
`

export async function loadDrinkStats(db: D1Database): Promise<DrinkStats[]> {
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
    loadDrinkStats(db),
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
