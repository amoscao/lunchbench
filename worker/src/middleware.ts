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
  'http://frontend:5173',
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

function requiresRestrictedCorsOrigin(c: Context): boolean {
  const method = c.req.method === 'OPTIONS'
    ? (c.req.header('Access-Control-Request-Method') ?? 'GET').toUpperCase()
    : c.req.method

  const path = c.req.path
  if (path.startsWith('/api/admin')) return true
  if (path.startsWith('/api/vote')) return true
  if (path.startsWith('/api/lunches') && method === 'POST') return true
  return false
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.includes(origin as (typeof ALLOWED_ORIGINS)[number])
    || isAllowedPagesPreviewOrigin(origin)
}

export function isAllowedCorsOriginForRequest(origin: string | null, c: Context): boolean {
  if (!origin) return true
  if (requiresRestrictedCorsOrigin(c)) {
    return isAllowedOrigin(origin)
  }
  return isAllowedOrigin(origin)
}

export function allowedCorsOrigin(origin: string, c: Context): string | null {
  if (!origin) return null
  return isAllowedCorsOriginForRequest(origin, c) ? origin : null
}

export const restrictBrowserOrigins: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin') ?? null
  if (!isAllowedCorsOriginForRequest(origin, c)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
  }

  await next()
}
