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
Authorization: Bearer <SESSION_TOKEN>
```

Create a session with `POST /api/admin/verify`.

Two session roles exist:
- `admin` — password from `ADMIN_MANAGER_PASSWORD`. Can access every protected route.
- `lunch` — password from `VOTE_PASSWORD`. Can create lunches and upload lunch images only.

Routes that require `lunch` accept either `admin` or `lunch` sessions.
Routes that require `admin` reject `lunch` sessions.

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
      "rating": 1500,
      "glicko_rd": 350,
      "glicko_volatility": 0.06,
      "conservative_rating": 800,
      "wins": 0,
      "losses": 0,
      "ties": 0,
      "created_at": "2024-09-23T12:00:00Z",
      "updated_at": "2024-09-23T14:00:00Z"
    }
  ]
}
```

---

### GET /api/lunches/leaderboard
Returns non-vegan lunches sorted by `conservative_rating` descending, then `name` ascending, then `id` ascending, with rank.

**Query params:**
- `?vegan=true` — only include vegan lunches

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
      "rating": 1600,
      "glicko_rd": 100,
      "glicko_volatility": 0.06,
      "conservative_rating": 1400,
      "confidence": 78,
      "consistency": 100,
      "consistency_band": "very-steady",
      "wins": 6,
      "losses": 0,
      "ties": 0,
      "created_at": "2024-09-23T12:00:00Z",
      "updated_at": "2024-09-23T14:00:00Z"
    }
  ]
}
```

---

### GET /api/matchup
Returns two selected lunches for voting.

**Headers:**
- `X-Lunchbench-Session: <uuid>` — optional browser-local session ticker. When present and valid, the server excludes pairs already acknowledged through `POST /api/matchup/seen` for the same session and vegan mode. Malformed values are ignored.

**Query params:**
- `?vegan=true` — return a vegan-only matchup (`is_vegan = 1`)
- (no param or any other value) — return a non-vegan matchup (`is_vegan = 0`)

Both lunches in the pair always share the same `is_vegan` value.
Selection weights the anchor lunch by `glicko_rd`, excludes session-seen pairs, avoids recent voted pairs when possible, then samples an opponent with a score based on rating proximity, opponent uncertainty, session presentation freshness, and small random jitter. Left/right sides are assigned randomly.
If the requested group has fewer than 2 lunches, the endpoint returns 204. If the requested session and vegan mode has seen every available pair, the endpoint returns 200 with `{ "status": "exhausted" }`.
Each lunch includes `rank`, its leaderboard position among lunches of the same vegan category by `conservative_rating`.
`matchup_token` is an opaque token for the served pair. The client sends it to `POST /api/matchup/seen` only after the matchup renders; prefetching a matchup does not mark it seen.

**Response 200:**
```json
{
  "status": "ok",
  "matchup_token": "550e8400-e29b-41d4-a716-446655440000",
  "left": { "rank": 1, /* full Lunch object, including conservative_rating */ },
  "right": { "rank": 2, /* full Lunch object, including conservative_rating */ },
  "projected": {
    "left_win": {
      "left": { "rating": 1520, "conservative_rating": 1320, "rank": 1 },
      "right": { "rating": 1480, "conservative_rating": 1280, "rank": 3 }
    },
    "right_win": {
      "left": { "rating": 1480, "conservative_rating": 1280, "rank": 3 },
      "right": { "rating": 1520, "conservative_rating": 1320, "rank": 1 }
    },
    "tie": {
      "left": { "rating": 1500, "conservative_rating": 1300, "rank": 2 },
      "right": { "rating": 1500, "conservative_rating": 1300, "rank": 2 }
    }
  }
}
```

`projected` contains read-only projected rating, conservative rating, and rank outcomes for each possible vote result.

**Response 200 exhausted:**
```json
{ "status": "exhausted" }
```

**Response 204:** (fewer than 2 lunches exist — no body)

---

### POST /api/matchup/seen
Records that a rendered matchup was presented to the user.

**Request body:**
```json
{ "token": "550e8400-e29b-41d4-a716-446655440000" }
```

The token must come from a prior successful `GET /api/matchup` response. Duplicate acknowledgements for the same token are treated as success.

**Response 200:**
```json
{ "ok": true }
```

**Errors:**
- `400 BAD_REQUEST` — invalid, missing, or unknown token
- `429 RATE_LIMITED` — exceeded 2000 seen acknowledgements/hour/IP

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
`left_lunch_id` and `right_lunch_id` must be different and must share the same `is_vegan` value. A vote between a vegan and non-vegan lunch returns 400 `BAD_REQUEST`.

**Response 200:**
```json
{
  "vote_id": 42,
  "left_result": {
    "rating": 1520,
    "conservative_rating": 1320,
    "rank": 2
  },
  "right_result": {
    "rating": 1480,
    "conservative_rating": 1280,
    "rank": 3
  }
}
```

`left_result` and `right_result` contain the post-vote ratings and current rank for each lunch.
The frontend prefetches the next full matchup with `GET /api/matchup`; the vote response does not include next matchup data.

**Errors:**
- `400 BAD_REQUEST` — invalid or missing fields, or same lunch on both sides
- `404 NOT_FOUND` — lunch id(s) not found
- `409 CONFLICT` — concurrent vote conflict after retries
- `429 RATE_LIMITED` — exceeded 30 votes/hour/IP, or voted on the same unordered lunch pair from the same IP within 24 hours

Vote writes retry from a fresh rating snapshot when another vote updates either lunch first. Counters are incremented in SQL so concurrent vote requests do not overwrite W/L/T totals.
Vote pair cooldowns use the same unordered lunch pair regardless of left/right side.

**Rate limit response:**
```json
{ "error": "Rate limit exceeded", "code": "RATE_LIMITED" }
```
Headers: `Retry-After: <seconds>`

---

### POST /api/lunches
Create a new lunch. **Requires lunch auth.**

Use `POST /api/admin/verify` with the admin or lunch password to obtain a session token, then send that token in `Authorization` for this request.
Tokens expire 8 hours after issuance.

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
Upload an image for a lunch. **Requires lunch auth.** Multipart form.

Use a current admin or lunch session token from `POST /api/admin/verify` in the `Authorization` header. Tokens expire 8 hours after issuance.

**Form field:** `image` (file)

**Constraints:**
- Max size: 5MB
- Min size: 100 bytes
- Allowed types: `image/jpeg`, `image/png`, `image/webp`
- Validated server-side by file signature and basic format structure

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
- `415 UNSUPPORTED_MEDIA_TYPE` — invalid file type, invalid signature, or invalid image structure
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
| GET /api/lunches | 120 | 1 hour | IP |
| GET /api/matchup | 2000 | 1 hour | IP |
| POST /api/matchup/seen | 2000 | 1 hour | IP |
| GET /api/lunches/leaderboard | 60 | 1 hour | IP |
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
  consistency?: number | null // 0-100 dominant outcome share after at least 5 votes
  consistency_band?: "very-steady" | "steady" | "mixed" | "high-swing" | null
  wins: number
  losses: number
  ties: number
  created_at: string         // ISO 8601
  updated_at: string
}
```

### GET /api/lunches/:id
Returns full stats for one lunch.

**Response 200:**
```json
{
  "id": 1,
  "name": "Margherita Pizza",
  "image_key": "images/abc123.jpg",
  "image_url": "/api/images/images/abc123.jpg",
  "rating": 1600,
  "glicko_rd": 100,
  "glicko_volatility": 0.06,
  "conservative_rating": 1400,
  "confidence": 78,
  "consistency": 80,
  "consistency_band": "steady",
  "win_rate": 0.8,
  "wins": 12,
  "losses": 2,
  "ties": 1,
  "momentum": 0,
  "is_vegan": 0,
  "created_at": "2024-09-23T12:00:00Z",
  "updated_at": "2024-09-23T14:00:00Z"
}
```

**Errors:**
- `400 BAD_REQUEST` — invalid id
- `404 NOT_FOUND` — lunch not found

---

## POST /api/admin/reset-scores

Requires admin session token.

Resets all dishes to baseline Glicko-2 values. Keeps name, description, and image unchanged. Deletes all votes and vote rate limits.

**Response 200:**
```json
{ "reset": true }
```

**Errors:**
- `401 UNAUTHORIZED` — missing or expired session token

### DELETE /api/admin/session

Invalidates the current admin session token.

Send current session token in `Authorization: Bearer <token>` to revoke it from `admin_sessions`.

**Response 200:**
```json
{ "revoked": true }
```

**Errors:**
- `401 UNAUTHORIZED` — missing or invalid session token
