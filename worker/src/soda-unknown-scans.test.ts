import { describe, expect, test } from 'vitest'
import { groupUnknownScans, type UnknownScanRow } from './soda-unknown-scans'

function scan(code: string, session: string, at: string, resolved: number | null = null, by: 'voter' | 'admin' | null = null): UnknownScanRow {
  return { code, format: 'upc_a', session_key: session, created_at: at, resolved_soda_id: resolved, resolved_by: by }
}

const names = new Map([[1, 'OLIPOP Vintage Cola'], [2, 'Coca-Cola Original']])

describe('groupUnknownScans', () => {
  test('groups by code with scan counts, distinct voters, first and last seen', () => {
    const groups = groupUnknownScans([
      scan('A', 's1', '2026-11-02 10:00:00'),
      scan('A', 's1', '2026-11-01 09:00:00'),
      scan('A', 's2', '2026-11-03 08:00:00'),
      scan('B', 's3', '2026-11-04 08:00:00'),
    ], new Map(), names)

    const a = groups.find((group) => group.code === 'A')!
    expect(a).toMatchObject({ scans: 3, voters: 2, first_seen: '2026-11-01 09:00:00', last_seen: '2026-11-03 08:00:00', formats: ['upc_a'] })
    expect(groups.map((group) => group.code)).toEqual(['B', 'A'])
  })

  test('counts voter picks per drink, not admin resolutions', () => {
    const [group] = groupUnknownScans([
      scan('A', 's1', '2026-11-01 00:00:00', 1, 'voter'),
      scan('A', 's2', '2026-11-01 00:00:01', 1, 'voter'),
      scan('A', 's3', '2026-11-01 00:00:02', 2, 'voter'),
      scan('A', 's4', '2026-11-01 00:00:03', 2, 'admin'),
      scan('A', 's5', '2026-11-01 00:00:04'),
    ], new Map(), names)

    expect(group.picks).toEqual([
      { soda_id: 1, name: 'OLIPOP Vintage Cola', count: 2 },
      { soda_id: 2, name: 'Coca-Cola Original', count: 1 },
    ])
  })

  test('shows the current mapping and lists unmapped codes first', () => {
    const groups = groupUnknownScans([
      scan('MAPPED', 's1', '2026-11-05 00:00:00'),
      scan('OPEN', 's1', '2026-11-01 00:00:00'),
    ], new Map([['MAPPED', { soda_id: 1, source: 'voter' as const }]]), names)

    expect(groups.map((group) => [group.code, group.mapped_name, group.mapped_source])).toEqual([
      ['OPEN', null, null],
      ['MAPPED', 'OLIPOP Vintage Cola', 'voter'],
    ])
  })

  test('never exposes session keys', () => {
    const groups = groupUnknownScans([scan('A', 'secret-session-key', '2026-11-01 00:00:00', 1, 'voter')], new Map(), names)
    expect(JSON.stringify(groups)).not.toContain('secret-session-key')
  })
})
