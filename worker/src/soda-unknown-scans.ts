// Admin view of the unknown-scan log (pure). Session keys go in, only counts come out.

export type UnknownScanRow = {
  code: string
  format: string
  session_key: string
  created_at: string
  resolved_soda_id: number | null
  resolved_by: 'voter' | 'admin' | null
}

export type UnknownScanPick = { soda_id: number; name: string; count: number }

export type BarcodeSource = 'seed' | 'voter' | 'admin'
export type CodeMapping = { soda_id: number; source: BarcodeSource }

export type UnknownScanGroup = {
  code: string
  formats: string[]
  scans: number
  voters: number
  first_seen: string
  last_seen: string
  /** Drinks voters reported manually right after scanning this code. Admin mappings are not picks. */
  picks: UnknownScanPick[]
  mapped_soda_id: number | null
  mapped_name: string | null
  mapped_source: BarcodeSource | null
}

/**
 * Groups scans by code. Unmapped codes come first, then the most recently seen.
 * `mapped` is the current soda_barcodes mapping per code; `names` maps soda id to display name.
 */
export function groupUnknownScans(
  rows: UnknownScanRow[],
  mapped: Map<string, CodeMapping>,
  names: Map<number, string>
): UnknownScanGroup[] {
  const groups = new Map<string, {
    formats: Set<string>
    sessions: Set<string>
    scans: number
    first: string
    last: string
    picks: Map<number, number>
  }>()

  for (const row of rows) {
    let group = groups.get(row.code)
    if (!group) {
      group = { formats: new Set(), sessions: new Set(), scans: 0, first: row.created_at, last: row.created_at, picks: new Map() }
      groups.set(row.code, group)
    }
    group.formats.add(row.format)
    group.sessions.add(row.session_key)
    group.scans += 1
    if (row.created_at < group.first) group.first = row.created_at
    if (row.created_at > group.last) group.last = row.created_at
    if (row.resolved_by === 'voter' && row.resolved_soda_id !== null) {
      group.picks.set(row.resolved_soda_id, (group.picks.get(row.resolved_soda_id) ?? 0) + 1)
    }
  }

  const nameOf = (id: number): string => names.get(id) ?? `#${id}`
  return [...groups.entries()]
    .map(([code, group]): UnknownScanGroup => {
      const mapping = mapped.get(code) ?? null
      const mappedId = mapping?.soda_id ?? null
      return {
        code,
        formats: [...group.formats].sort(),
        scans: group.scans,
        voters: group.sessions.size,
        first_seen: group.first,
        last_seen: group.last,
        picks: [...group.picks.entries()]
          .map(([sodaId, count]) => ({ soda_id: sodaId, name: nameOf(sodaId), count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        mapped_soda_id: mappedId,
        mapped_name: mappedId === null ? null : nameOf(mappedId),
        mapped_source: mapping?.source ?? null,
      }
    })
    .sort((a, b) => {
      const mappedOrder = Number(a.mapped_soda_id !== null) - Number(b.mapped_soda_id !== null)
      if (mappedOrder !== 0) return mappedOrder
      if (a.last_seen !== b.last_seen) return a.last_seen < b.last_seen ? 1 : -1
      return a.code.localeCompare(b.code)
    })
}
