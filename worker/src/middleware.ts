import { MiddlewareHandler } from 'hono'
import type { Context } from 'hono'

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
}

const ALLOWED_ORIGINS = [
  'https://lunchbench.xyz',
  'https://www.lunchbench.xyz',
  'https://lunchbench.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://[::1]:5173',
  'http://[::1]:4173',
] as const

const PAGES_PREVIEW_HOST_SUFFIX = '.lunchbench.pages.dev'

function isAllowedPagesPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.hostname.endsWith(PAGES_PREVIEW_HOST_SUFFIX)
  } catch {
    return false
  }
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.includes(origin as (typeof ALLOWED_ORIGINS)[number])
    || isAllowedPagesPreviewOrigin(origin)
}

export function allowedCorsOrigin(origin: string, _c: Context): string | null {
  if (!origin) return null
  return isAllowedOrigin(origin) ? origin : null
}

export const restrictBrowserOrigins: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin') ?? null
  if (!isAllowedOrigin(origin)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
  }

  await next()
}
