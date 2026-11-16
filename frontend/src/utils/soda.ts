import type { SodaOrderItem, SodaType } from '../api'

export function sodaTypeLabel(type: SodaType): 'Soda' | 'Seltzer' {
  return type === 'seltzer' ? 'Seltzer' : 'Soda'
}

export function newDrinkText(type: SodaType): string {
  return type === 'seltzer' ? 'New seltzer to try' : 'New soda to try'
}

export type OrderTag = 'Soda' | 'Seltzer' | 'Trial'

export function orderTag(item: Pick<SodaOrderItem, 'slot' | 'type'>): OrderTag {
  if (item.slot === 'trial') return 'Trial'
  return sodaTypeLabel(item.type)
}

/** "2026-11-16" -> "Week of Nov 16". Parsed as a calendar date, so the viewer's zone cannot shift it. */
export function formatWeekOf(weekStart: string): string {
  const [year, month, day] = weekStart.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `Week of ${label}`
}

/** Drag distance, in px, past which a released card counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 96

export function swipeDirection(dx: number, threshold = SWIPE_THRESHOLD_PX): 'right' | 'left' | null {
  if (dx >= threshold) return 'right'
  if (dx <= -threshold) return 'left'
  return null
}
