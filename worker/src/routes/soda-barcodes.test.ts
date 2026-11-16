import { describe, expect, test } from 'vitest'
import { sodaRouter } from './soda'
import { adminRouter } from './admin'
import type { Bindings } from '../types'
import { createTestD1 } from '../../test/sqlite-d1'

const VOTER = '550e8400-e29b-41d4-a716-446655440000'
const OTHER = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
// Valid check digits; not real products, so never in the seed.
const UNKNOWN_UPC_A = '012345678905'
const UNKNOWN_GTIN = '0012345678905'
const OTHER_GTIN = '0098765432105'

function setup() {
  const { db, sqlite } = createTestD1()
  const sodaId = (walmartId: string) => Number(sqlite.prepare('SELECT id FROM sodas WHERE walmart_item_id = ?').get(walmartId)!.id)
  const cola = sodaId('7097351727') // OLIPOP Vintage Cola
  const coke = sodaId('12166733') // Coca-Cola Original
  const env: Bindings = { DB: db, IMAGES: undefined, VOTE_PASSWORD: '', ADMIN_MANAGER_PASSWORD: '', SENTRY_DSN: '' }
  const expires = new Date(Date.now() + 86_400_000).toISOString()
  for (const role of ['admin', 'lunch', 'purchaser']) {
    sqlite.prepare('INSERT INTO admin_sessions (token, expires_at, role) VALUES (?, ?, ?)').run(`${role}-token`, expires, role)
  }
  const voter = (method: string, path: string, body: unknown, session: string | null = VOTER) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (session) headers['X-Lunchbench-Session'] = session
    return sodaRouter.request(path, { method, headers, body: JSON.stringify(body) }, env)
  }
  const adminCall = (method: string, path: string, body?: unknown, token = 'admin-token') =>
    adminRouter.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env)
  const mapping = (code: string) => sqlite.prepare('SELECT soda_id, source FROM soda_barcodes WHERE code = ?').get(code)
  return { sqlite, env, cola, coke, voter, adminCall, mapping }
}

describe('unknown-scan log', () => {
  test('logs the normalized code, format and session', async () => {
    const { sqlite, voter } = setup()
    const res = await voter('POST', '/unknown-scans', { barcode: '04963406', format: 'upc_e' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, code: '0049000006346' })
    expect({ ...sqlite.prepare('SELECT code, format, session_key, resolved_soda_id FROM soda_unknown_scans').get() }).toEqual({
      code: '0049000006346', format: 'upc_e', session_key: VOTER, resolved_soda_id: null,
    })
  })

  test('rejects missing sessions, bad formats and bad check digits', async () => {
    const { sqlite, voter } = setup()
    expect((await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' }, null)).status).toBe(400)
    expect((await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'qr_code' })).status).toBe(400)
    expect((await voter('POST', '/unknown-scans', { barcode: '012345678904', format: 'upc_a' })).status).toBe(400)
    expect((await voter('POST', '/unknown-scans', { barcode: 'data:image/jpeg;base64,AAAA', format: 'upc_a' })).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_unknown_scans').get()!.n).toBe(0)
  })

  test('is rate-limited per IP', async () => {
    const { voter } = setup()
    let last = 0
    for (let i = 0; i < 61; i++) last = (await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })).status
    expect(last).toBe(429)
  })
})

describe('voter barcode learning', () => {
  test('unknown scan then manual report resolves the scan and maps the code', async () => {
    const { sqlite, voter, cola, mapping } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    const res = await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN })

    expect(await res.json()).toEqual({ ok: true, barcode_soda_id: cola })
    expect({ ...mapping(UNKNOWN_GTIN) }).toEqual({ soda_id: cola, source: 'voter' })
    expect({ ...sqlite.prepare('SELECT resolved_soda_id, resolved_by FROM soda_unknown_scans').get() }).toEqual({ resolved_soda_id: cola, resolved_by: 'voter' })

    const list = await (await voter('GET', '/barcodes', undefined)).json() as { barcodes: { code: string; soda_id: number }[] }
    expect(list.barcodes).toContainEqual({ code: UNKNOWN_GTIN, soda_id: cola })
  })

  test('the first mapping wins', async () => {
    const { voter, cola, coke, mapping } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN })
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' }, OTHER)
    const res = await voter('POST', '/reports', { soda_id: coke, verdict: 'hate', barcode: UNKNOWN_GTIN }, OTHER)

    expect(await res.json()).toEqual({ ok: true, barcode_soda_id: cola })
    expect(mapping(UNKNOWN_GTIN)!.soda_id).toBe(cola)
  })

  test('a report cannot map a code its voter never logged as unknown', async () => {
    const { voter, cola, mapping } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' }, OTHER)
    const res = await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, barcode_soda_id: null })
    expect(mapping(UNKNOWN_GTIN)).toBeUndefined()
  })

  test('learning is rate-limited but the report still counts', async () => {
    const { sqlite, voter, cola, mapping } = setup()
    sqlite.prepare("INSERT INTO rate_limits (key, action, count, window_start) VALUES ('unknown', 'soda_barcode_learn', 20, ?)")
      .run(new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString())
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    const res = await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN })

    expect(res.status).toBe(200)
    expect(mapping(UNKNOWN_GTIN)).toBeUndefined()
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_reports').get()!.n).toBe(1)
  })

  test('rejects an invalid report barcode before writing', async () => {
    const { sqlite, voter, cola } = setup()
    expect((await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: '012345678904' })).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM soda_reports').get()!.n).toBe(0)
  })

  test('the barcode list skips inactive drinks', async () => {
    const { sqlite, voter, cola } = setup()
    sqlite.prepare("INSERT INTO soda_barcodes (code, soda_id, source) VALUES (?, ?, 'admin')").run(OTHER_GTIN, cola)
    sqlite.prepare('UPDATE sodas SET is_active = 0 WHERE id = ?').run(cola)
    const list = await (await voter('GET', '/barcodes', undefined)).json() as { barcodes: { code: string }[] }
    expect(list.barcodes.map((row) => row.code)).not.toContain(OTHER_GTIN)
  })
})

describe('admin unknown scans', () => {
  test('requires an admin session', async () => {
    const { adminCall, cola } = setup()
    for (const token of ['lunch-token', 'purchaser-token', 'nope']) {
      expect((await adminCall('GET', '/soda/unknown-scans', undefined, token)).status).toBe(401)
      expect((await adminCall('POST', '/soda/barcodes', { code: UNKNOWN_GTIN, soda_id: cola }, token)).status).toBe(401)
      expect((await adminCall('DELETE', `/soda/unknown-scans/${UNKNOWN_GTIN}`, undefined, token)).status).toBe(401)
    }
  })

  test('lists grouped codes with picks and no session keys', async () => {
    const { voter, adminCall, cola } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' }, OTHER)
    await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN }, OTHER)

    const res = await adminCall('GET', '/soda/unknown-scans')
    const text = await res.text()
    expect(text).not.toContain(VOTER)
    expect(text).not.toContain(OTHER)
    const { codes } = JSON.parse(text) as { codes: Record<string, unknown>[] }
    expect(codes).toHaveLength(1)
    expect(codes[0]).toMatchObject({
      code: UNKNOWN_GTIN,
      scans: 2,
      voters: 2,
      picks: [{ soda_id: cola, name: 'OLIPOP Vintage Cola', count: 1 }],
      mapped_soda_id: cola,
      mapped_name: 'OLIPOP Vintage Cola',
      mapped_source: 'voter',
    })
  })

  test('maps a code (overriding a voter mapping) and resolves its open scans', async () => {
    const { sqlite, voter, adminCall, cola, coke, mapping } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN })
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' }, OTHER)

    const res = await adminCall('POST', '/soda/barcodes', { code: UNKNOWN_UPC_A, soda_id: coke })
    expect(await res.json()).toEqual({ code: UNKNOWN_GTIN, soda_id: coke })
    expect({ ...mapping(UNKNOWN_GTIN) }).toEqual({ soda_id: coke, source: 'admin' })
    const rows = sqlite.prepare('SELECT session_key, resolved_soda_id, resolved_by FROM soda_unknown_scans ORDER BY id').all().map((row) => ({ ...row }))
    expect(rows).toEqual([
      { session_key: VOTER, resolved_soda_id: cola, resolved_by: 'voter' },
      { session_key: OTHER, resolved_soda_id: coke, resolved_by: 'admin' },
    ])
  })

  test('rejects bad codes and unknown drinks', async () => {
    const { adminCall, cola } = setup()
    expect((await adminCall('POST', '/soda/barcodes', { code: '012345678904', soda_id: cola })).status).toBe(400)
    expect((await adminCall('POST', '/soda/barcodes', { code: UNKNOWN_GTIN, soda_id: 99999 })).status).toBe(404)
  })

  test('dismiss deletes the code from the log', async () => {
    const { sqlite, voter, adminCall } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    await voter('POST', '/unknown-scans', { barcode: '098765432105', format: 'upc_a' })

    expect(await (await adminCall('DELETE', `/soda/unknown-scans/${UNKNOWN_GTIN}`)).json()).toEqual({ dismissed: 1, voter_mapping_removed: false })
    expect(sqlite.prepare('SELECT code FROM soda_unknown_scans').all().map((row) => row.code)).toEqual([OTHER_GTIN])
  })

  test('dismiss removes a voter-learned mapping, so the next scan is unknown and logged again', async () => {
    const { voter, adminCall, cola, mapping } = setup()
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    await voter('POST', '/reports', { soda_id: cola, verdict: 'like', barcode: UNKNOWN_GTIN })
    expect(mapping(UNKNOWN_GTIN)!.source).toBe('voter')

    expect(await (await adminCall('DELETE', `/soda/unknown-scans/${UNKNOWN_GTIN}`)).json()).toEqual({ dismissed: 1, voter_mapping_removed: true })
    expect(mapping(UNKNOWN_GTIN)).toBeUndefined()
    const list = await (await voter('GET', '/barcodes', undefined)).json() as { barcodes: { code: string }[] }
    expect(list.barcodes.map((row) => row.code)).not.toContain(UNKNOWN_GTIN)
  })

  test('dismiss keeps admin and seed mappings', async () => {
    const { sqlite, voter, adminCall, coke, mapping } = setup()
    const seeded = sqlite.prepare("SELECT code, soda_id FROM soda_barcodes WHERE source = 'seed' LIMIT 1").get()!
    await voter('POST', '/unknown-scans', { barcode: String(seeded.code), format: 'ean_13' })
    await voter('POST', '/unknown-scans', { barcode: UNKNOWN_UPC_A, format: 'upc_a' })
    await adminCall('POST', '/soda/barcodes', { code: UNKNOWN_GTIN, soda_id: coke })

    for (const code of [String(seeded.code), UNKNOWN_GTIN]) {
      expect(await (await adminCall('DELETE', `/soda/unknown-scans/${code}`)).json()).toEqual({ dismissed: 1, voter_mapping_removed: false })
    }
    expect({ ...mapping(String(seeded.code)) }).toEqual({ soda_id: seeded.soda_id, source: 'seed' })
    expect({ ...mapping(UNKNOWN_GTIN) }).toEqual({ soda_id: coke, source: 'admin' })
  })
})
