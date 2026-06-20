# Lunchbench API Contract

Base URL (local): `http://localhost:8787`
Base URL (production): `https://lunchbench-api.<account>.workers.dev`

All responses are JSON. All errors use the format:
```json
{ "error": "Human-readable message", "code": "ERROR_CODE" }
```

## Authentication

Protected routes require:
```
Authorization: Bearer <ADMIN_TOKEN>
```

Returns `401` if missing or invalid.

---

## Routes

### GET /api/health
Returns server status.

**Response 200:**
```json
{ "ok": true }
```

---

### GET /api/lunches
Returns all lunches.

**Query params:**
- `?missing_image=true` — filter to lunches where `image_key IS NULL`

**Response 200:**
```json
{
  "lunches": [
    {
      "id": 1,
      "name": "Margherita Pizza",
      "image_key": null,
      "image_url": null,
      "rating": 1024.5,
      "wins": 10,
      "losses": 3,
      "ties": 1,
      "created_at": "2024-09-23T12:00:00Z",
      "updated_at": "2024-09-23T14:00:00Z"
    }
  ]
}
```

---

### GET /api/lunches/leaderboard
Returns all lunches sorted by `conservative_rating` descending, with rank.

**Response 200:**
```json
{
  "lunches": [
    {
      "rank": 1,
      "id": 1,
      "name": "Margherita Pizza",
      "image_key": "images/abc123.jpg",
      "image_url": "/api/images/images/abc123.jpg",
      "rating": 1024.5,
      "glicko_rd": 340.2,
      "glicko_volatility": 0.06,
      "conservative_rating": 1344.1,
      "confidence": 84,
      "wins": 10,
      "losses": 3,
      "ties": 1,
      "created_at": "2024-09-23T12:00:00Z",
      "updated_at": "2024-09-23T14:00:00Z"
    }
  ]
}
```

---

### GET /api/matchup
Returns two randomly selected lunches for voting.

**Response 200:**
```json
{
  "left": { /* Lunch object */ },
  "right": { /* Lunch object */ }
}
```

**Response 204:** (fewer than 2 lunches exist — no body)

---

### POST /api/vote
Submit a vote for a matchup.

**Request body:**
```json
{
  "left_lunch_id": 1,
  "right_lunch_id": 2,
  "result": "left_win"
}
```

`result` must be one of: `"left_win"`, `"right_win"`, `"tie"`

**Response 200:**
```json
{
  "vote_id": 42,
  "next": {
    "left": { /* Lunch object */ },
    "right": { /* Lunch object */ }
  }
}
```

`next` is `null` if fewer than 2 lunches are available for the next matchup.

**Errors:**
- `400 BAD_REQUEST` — invalid or missing fields
- `404 NOT_FOUND` — lunch id(s) not found
- `429 RATE_LIMITED` — exceeded 30 votes/hour/IP

**Rate limit response:**
```json
{ "error": "Rate limit exceeded", "code": "RATE_LIMITED" }
```
Headers: `Retry-After: <seconds>`

---

### POST /api/lunches
Create a new lunch. **Requires auth.**

**Request body:**
```json
{ "name": "Chicken Tacos" }
```

**Response 201:**
```json
{ "lunch": { /* Lunch object */ } }
```

**Errors:**
- `400 BAD_REQUEST` — name missing or exceeds 100 chars
- `401 UNAUTHORIZED` — missing or invalid token
- `429 RATE_LIMITED` — exceeded 10 lunch creations/day/IP

---

### POST /api/lunches/:id/image
Upload an image for a lunch. **Requires auth.** Multipart form.

**Form field:** `image` (file)

**Constraints:**
- Max size: 5MB
- Allowed types: `image/jpeg`, `image/png`, `image/webp`
- Validated by magic bytes server-side

**Response 200:**
```json
{
  "image_key": "images/550e8400-e29b-41d4-a716-446655440000.jpg",
  "image_url": "/api/images/images/550e8400-e29b-41d4-a716-446655440000.jpg"
}
```

**Errors:**
- `401 UNAUTHORIZED`
- `404 NOT_FOUND` — lunch not found
- `413 PAYLOAD_TOO_LARGE` — file exceeds 5MB
- `415 UNSUPPORTED_MEDIA_TYPE` — invalid file type or magic bytes mismatch
- `429 RATE_LIMITED` — exceeded 5 uploads/day/IP

---

### GET /api/images/:key
Serve an image from R2.

**Example:** `GET /api/images/images/abc123.jpg`

**Response 200:** Image binary with headers:
```
Content-Type: image/jpeg
Cache-Control: public, max-age=31536000, immutable
```

**Response 404:** Image not found.

---

## Rate Limits Summary

| Route | Limit | Window | Key |
|-------|-------|--------|-----|
| POST /api/vote | 30 | 1 hour | IP |
| POST /api/lunches/:id/image | 5 | 24 hours | IP |
| POST /api/lunches | 10 | 24 hours | IP |

IP is read from `CF-Connecting-IP` header, falling back to `X-Forwarded-For`.

---

## Lunch Object Shape

```typescript
type Lunch = {
  id: number
  name: string
  image_key: string | null
  image_url: string | null   // derived: "/api/images/<image_key>" or null
  rating: number             // Glicko-2 rating, starts at 1500
  glicko_rd: number          // RD, starts at 350
  glicko_volatility: number  // starts at 0.06
  conservative_rating: number // rating - (2 * glicko_rd), starts at 800
  confidence?: number         // 0-100 value derived from RD (higher is more certain), currently returned on leaderboard responses
  wins: number
  losses: number
  ties: number
  created_at: string         // ISO 8601
  updated_at: string
}
```
