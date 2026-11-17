import type { ErrorEvent } from '@sentry/cloudflare'
import type { Bindings } from './types'

// Request headers that carry credentials or the voter id. The SDK already strips IP headers and
// cookies because sendDefaultPii is off, but it keeps these.
const SECRET_HEADERS = new Set(['authorization', 'x-lunchbench-session', 'cookie'])

/**
 * Drops request data Sentry must never get (#262). The SDK attaches the JSON body of every request
 * by default, so a 429 on POST /api/admin/verify would otherwise send the typed password.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request
  if (!request) return event
  delete request.data
  delete request.cookies
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      if (SECRET_HEADERS.has(name.toLowerCase())) delete request.headers[name]
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
