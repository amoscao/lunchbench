import { MiddlewareHandler } from 'hono'

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
}

const ALLOWED_ORIGINS = [
  'https://lunchbench.xyz',
  'https://www.lunchbench.xyz',
  'http://localhost:5173',
  'http://localhost:4173',
]

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.some((o) => origin === o || origin.endsWith('.lunchbench.xyz'))
}
