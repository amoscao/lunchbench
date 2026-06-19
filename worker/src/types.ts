export type Bindings = {
  DB: D1Database
  IMAGES: R2Bucket | undefined
  VOTE_PASSWORD: string
  ADMIN_MANAGER_PASSWORD: string
}

export type Lunch = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  image_url: string | null
  is_vegan: number
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
  description: string | null
  image_key: string | null
  is_vegan: number
  rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}
