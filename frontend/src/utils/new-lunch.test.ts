import { describe, expect, test } from 'vitest'
import { isNewLunch, NEW_LUNCH_WINDOW_MS, parseUtcTimestamp } from './new-lunch'

describe('parseUtcTimestamp', () => {
  test('runs in a non-UTC zone so local-time parsing would be caught', () => {
    expect(new Date(Date.UTC(2026, 9, 5)).getTimezoneOffset()).not.toBe(0)
  })

  test('reads D1 datetime format as UTC', () => {
    expect(parseUtcTimestamp('2026-10-05 12:00:00')).toBe(Date.UTC(2026, 9, 5, 12, 0, 0))
  })

  test('reads ISO strings with a zone as given', () => {
    expect(parseUtcTimestamp('2026-10-05T12:00:00Z')).toBe(Date.UTC(2026, 9, 5, 12, 0, 0))
    expect(parseUtcTimestamp('2026-10-05T08:00:00-04:00')).toBe(Date.UTC(2026, 9, 5, 12, 0, 0))
  })

  test('returns NaN for missing or invalid values', () => {
    expect(parseUtcTimestamp(undefined)).toBeNaN()
    expect(parseUtcTimestamp('')).toBeNaN()
    expect(parseUtcTimestamp('not a date')).toBeNaN()
  })
})

describe('isNewLunch', () => {
  const created = '2026-10-05 12:00:00'
  const createdMs = Date.UTC(2026, 9, 5, 12, 0, 0)

  test('is new right after creation', () => {
    expect(isNewLunch({ created_at: created }, createdMs)).toBe(true)
  })

  test('is new 1 ms before the 7-day mark', () => {
    expect(isNewLunch({ created_at: created }, createdMs + NEW_LUNCH_WINDOW_MS - 1)).toBe(true)
  })

  test('is not new at exactly 7 days', () => {
    expect(isNewLunch({ created_at: created }, createdMs + NEW_LUNCH_WINDOW_MS)).toBe(false)
  })

  test('is not new after 7 days', () => {
    expect(isNewLunch({ created_at: created }, createdMs + NEW_LUNCH_WINDOW_MS + 60_000)).toBe(false)
  })

  test('boundary does not shift with a timezone offset', () => {
    // If the D1 string were parsed as local time in UTC-4, the lunch would
    // still look new 4 hours past the real 7-day mark.
    expect(isNewLunch({ created_at: created }, createdMs + NEW_LUNCH_WINDOW_MS + 4 * 60 * 60 * 1000 - 1)).toBe(false)
  })

  test('is not new when created_at is missing or invalid', () => {
    expect(isNewLunch({}, createdMs)).toBe(false)
    expect(isNewLunch({ created_at: 'garbage' }, createdMs)).toBe(false)
  })
})
