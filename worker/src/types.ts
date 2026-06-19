export type Bindings = {
  DB: D1Database
  IMAGES: R2Bucket | undefined
  ADMIN_TOKEN: string
}

export type Lunch = {
  id: number
  name: string
  image_key: string | null
  image_url: string | null
  rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}

export type LunchRow = {
  id: number
  name: string
  image_key: string | null
  rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}
