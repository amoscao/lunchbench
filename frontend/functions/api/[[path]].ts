// The Worker sees this proxy's Cloudflare egress IP as CF-Connecting-IP, not the visitor's (#307).
// So the proxy forwards the visitor IP plus PROXY_SECRET, and the Worker trusts the IP only when the
// secret matches. Keep both header names in sync with worker/src/rate-limit.ts.
const CLIENT_IP_HEADER = 'X-Lunchbench-Client-IP'
const PROXY_SECRET_HEADER = 'X-Lunchbench-Proxy-Secret'

const WORKER_URL = 'https://lunchbench-api.woodamca.workers.dev'

type ProxyContext = {
  request: Request
  env: { PROXY_SECRET?: string }
}

export const onRequest = async (context: ProxyContext): Promise<Response> => {
  const { request, env } = context
  const url = new URL(request.url)
  const targetUrl = WORKER_URL + url.pathname + url.search

  // Never pass on client-supplied copies. Without PROXY_SECRET, send neither header.
  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  headers.delete(PROXY_SECRET_HEADER)
  const clientIp = request.headers.get('CF-Connecting-IP')
  if (env.PROXY_SECRET && clientIp) {
    headers.set(CLIENT_IP_HEADER, clientIp)
    headers.set(PROXY_SECRET_HEADER, env.PROXY_SECRET)
  }

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  })
}
