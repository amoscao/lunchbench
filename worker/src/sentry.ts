import type { ErrorEvent } from '@sentry/cloudflare'
import type { Bindings } from './types'

// The only request headers events keep. An allowlist, because the SDK strips just its own list of
// IP headers and keeps the rest: Authorization, X-Lunchbench-Session, CF-Connecting-IPv6, ...
const KEPT_HEADERS = new Set(['content-type', 'user-agent'])

/**
 * Drops request data Sentry must never get (#262): the body (the SDK attaches JSON bodies by
 * default, so a 429 on POST /api/admin/verify would send the typed password), cookies, every
 * header outside KEPT_HEADERS, and any user IP.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.user) delete event.user.ip_address
  const request = event.request
  if (!request) return event
  delete request.data
  delete request.cookies
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      if (!KEPT_HEADERS.has(name.toLowerCase())) delete request.headers[name]
    }
  }
  return event
}

/** Shared Worker Sentry options. An empty SENTRY_DSN disables the client, so nothing is sent. */
export function sentryOptions(env: Bindings) {
  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0,
    // Keep client IPs out of events. Rate-limit warnings carry a keyed hash instead.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  }
}
