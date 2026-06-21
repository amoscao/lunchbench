const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://gc.zgo.at",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://lunchbench.goatcounter.com",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export const onRequest: PagesFunction = async (context) => {
  const country = (context.request as Request & { cf?: { country?: string } }).cf?.country

  if (country && country !== 'US') {
    return new Response('Access restricted to US visitors.', { status: 403 })
  }

  const response = await context.next()
  const contentType = response.headers.get('Content-Type') ?? ''

  if (!contentType.toLowerCase().includes('text/html')) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
