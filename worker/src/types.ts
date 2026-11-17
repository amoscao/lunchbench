export type Bindings = {
  DB: D1Database
  IMAGES: R2Bucket | undefined
  VOTE_PASSWORD: string
  ADMIN_MANAGER_PASSWORD: string
  PURCHASER_PASSWORD?: string
  SENTRY_DSN: string
  // HMAC key for the IP hash in rate-limit Sentry events (#262). Optional.
  IP_HASH_KEY?: string
  // Shared with the Pages proxy so the Worker can trust its forwarded client IP (#307). Optional.
  PROXY_SECRET?: string
}

export type Lunch = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  image_url: string | null
  is_vegan: number
  is_legacy: number
  rank?: number
  rating: number
  glicko_rd: number
  glicko_volatility: number
  conservative_rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}

export type LunchRow = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  is_vegan: number
  is_legacy: number
  rating: number
  glicko_rd: number
  glicko_volatility: number
  conservative_rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}

export type LeaderboardRow = Lunch & {
  confidence: number
  consistency: number | null
  consistency_band: string | null
}
