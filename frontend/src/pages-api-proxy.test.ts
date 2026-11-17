import { afterEach, describe, expect, test, vi } from 'vitest'
import { onRequest } from '../functions/api/[[path]]'

// #307: the Pages Function proxy forwards the visitor IP to the Worker with PROXY_SECRET, and never
// passes on client-supplied copies of either header.
const VISITOR_IP = '203.0.113.42'

async function proxy(headers: Record<string, string>, env: { PROXY_SECRET?: string }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const request = new Request('https://lunchbench.xyz/api/soda/feed?limit=5', { headers })
  const res = await onRequest({ request, env })
  expect(res.status).toBe(200)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]
  return { url, method: init?.method, redirect: init?.redirect, sent: new Headers(init?.headers) }
}

describe('Pages /api proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('forwards the visitor IP and secret when PROXY_SECRET is set', async () => {
    const { url, method, redirect, sent } = await proxy(
      { 'CF-Connecting-IP': VISITOR_IP, 'X-Lunchbench-Session': 'session-key' },
      { PROXY_SECRET: 'proxy-secret' }
    )
    expect(url).toBe('https://lunchbench-api.woodamca.workers.dev/api/soda/feed?limit=5')
    expect(method).toBe('GET')
    expect(redirect).toBe('manual')
    expect(sent.get('X-Lunchbench-Client-IP')).toBe(VISITOR_IP)
    expect(sent.get('X-Lunchbench-Proxy-Secret')).toBe('proxy-secret')
    expect(sent.get('X-Lunchbench-Session')).toBe('session-key')
  })

  test('replaces client-supplied copies of both headers', async () => {
    const { sent } = await proxy(
      {
        'CF-Connecting-IP': VISITOR_IP,
        'X-Lunchbench-Client-IP': '198.51.100.7',
        'X-Lunchbench-Proxy-Secret': 'guessed-secret',
      },
      { PROXY_SECRET: 'proxy-secret' }
    )
    expect(sent.get('X-Lunchbench-Client-IP')).toBe(VISITOR_IP)
    expect(sent.get('X-Lunchbench-Proxy-Secret')).toBe('proxy-secret')
  })

  test('without PROXY_SECRET sends neither header, even when the client sent them', async () => {
    const { sent } = await proxy(
      {
        'CF-Connecting-IP': VISITOR_IP,
        'X-Lunchbench-Client-IP': '198.51.100.7',
        'X-Lunchbench-Proxy-Secret': 'guessed-secret',
      },
      {}
    )
    expect(sent.has('X-Lunchbench-Client-IP')).toBe(false)
    expect(sent.has('X-Lunchbench-Proxy-Secret')).toBe(false)
  })

  test('without a visitor IP sends neither header', async () => {
    const { sent } = await proxy({ 'X-Lunchbench-Client-IP': '198.51.100.7' }, { PROXY_SECRET: 'proxy-secret' })
    expect(sent.has('X-Lunchbench-Client-IP')).toBe(false)
    expect(sent.has('X-Lunchbench-Proxy-Secret')).toBe(false)
  })
})
