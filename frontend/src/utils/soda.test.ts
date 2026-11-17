import { describe, expect, test } from 'vitest'
import { formatWeekOf, newDrinkText, orderTag, sodaTypeLabel } from './soda'

describe('soda display helpers', () => {
  test('labels types', () => {
    expect(sodaTypeLabel('soda')).toBe('Soda')
    expect(sodaTypeLabel('seltzer')).toBe('Seltzer')
    expect(newDrinkText('soda')).toBe('New soda to try')
    expect(newDrinkText('seltzer')).toBe('New seltzer to try')
  })

  test('tags order rows by slot', () => {
    expect(orderTag({ slot: 'top', type: 'soda' })).toBe('Soda')
    expect(orderTag({ slot: 'top', type: 'seltzer' })).toBe('Seltzer')
    expect(orderTag({ slot: 'trial', type: 'seltzer' })).toBe('Trial')
  })

  test('formats the week start without a zone shift', () => {
    // vitest runs with TZ=America/New_York, where a UTC-midnight parse would show Nov 15.
    expect(formatWeekOf('2026-11-16')).toBe('Week of Nov 16')
  })
})
