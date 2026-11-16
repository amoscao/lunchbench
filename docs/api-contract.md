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
Sessions expire 1 year after issuance.

Three session roles exist:
- `admin` — password from `ADMIN_MANAGER_PASSWORD`. Can access every protected route.
- `lunch` — password from `VOTE_PASSWORD`. Can create lunches and upload lunch images only.
- `purchaser` — password from `PURCHASER_PASSWORD`. Can read the weekly soda order list (`GET /api/soda/order/latest`) only.

Routes that require `lunch` accept either `admin` or `lunch` sessions.
Routes that require `purchaser` accept either `admin` or `purchaser` sessions.
Routes that require `admin` reject `lunch` and `purchaser` sessions.

`POST /api/admin/verify` checks the admin password first, then the lunch password, then the purchaser password. It returns `{ "token": "<uuid>", "role": "admin" | "lunch" | "purchaser" }`.

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
Legacy lunches (`is_legacy = 1`, Paula Legacy Lunch) are never served. Only non-legacy lunches enter the matchup pool. They still appear on the leaderboard and count toward `rank`. The admin PDF export leaves them out and renumbers ranks.
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

Vote writes retry from a fresh rating snapshot when another vote updates either lunch first. Counters are incremented in SQL so concurrent vote requests do not overwrite W/L/T totals.

---

### POST /api/lunches
Create a new lunch. **Requires lunch auth.**

Use `POST /api/admin/verify` with the admin or lunch password to obtain a session token, then send that token in `Authorization` for this request.
Tokens expire 1 year after issuance.

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

---

### POST /api/lunches/:id/image
Upload an image for a lunch. **Requires lunch auth.** Multipart form.

Use a current admin or lunch session token from `POST /api/admin/verify` in the `Authorization` header. Tokens expire 1 year after issuance.

**Form field:** `image` (file)

**Constraints:**
- Server upload ceiling: 25MB multipart body/file size
- Min size: 100 bytes
- Allowed types: `image/jpeg`, `image/png`, `image/webp`
- Validated server-side by file signature and basic format structure

The frontend also accepts HEIC/HEIF and AVIF selections. HEIC/HEIF images are converted to JPEG in the browser before validation. Large selected images are downscaled in the browser to a maximum 2000px longest side before the crop UI opens, then the cropped upload is emitted as an 800px JPEG.

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
- `413 PAYLOAD_TOO_LARGE` — upload exceeds the server-side upload ceiling
- `415 UNSUPPORTED_MEDIA_TYPE` — invalid file type, invalid signature, or invalid image structure

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
  is_vegan: number           // 1 or 0
  is_legacy: number          // 1 = Paula Legacy Lunch (existed before the caterer change), 0 = added later
  created_at: string         // D1 datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC, no zone suffix. The frontend shows a "New" badge when it is under 7 days old.
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
  "is_legacy": 1,
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

Resets all dishes to baseline Glicko-2 values. Keeps name, description, and image unchanged. Deletes all votes.

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

---

## Sodabench

Sodabench ranks the canned sodas and seltzers stocked at Walmart Branford CT #2232.
Voters swipe drinks and report drinks they had. The purchaser reads a frozen weekly order list.

Voter identity is the browser-local `lb_session_id` UUID sent as `X-Lunchbench-Session`. There is no voter login.
Writes require a valid session header and return `400 BAD_REQUEST` without one.
Writes are rate-limited per client IP: swipes 1200 per hour, reports 60 per hour (`429 RATE_LIMITED`).

**Accepted risk: ballot stuffing.** Voters have no login. The session UUID is client-generated, so one person can clear localStorage (or script fresh UUIDs) and swipe or report the same drink many times. The per-IP rate limits cap the damage, but a shared office IP means they must stay loose. Lunchbench accepts this for an internal office tool. The order list is advisory and Chris can skip any row.
Writes come only from allowed browser origins (see `docs/13-environment-and-deployment-config.md`).

### Soda Object Shape

```typescript
type Soda = {
  id: number
  brand: string
  flavor: string
  name: string               // "<brand> <flavor>"
  type: "soda" | "seltzer"
  image_url: string | null   // "/api/images/<image_key>"
}
```

### Scoring

Pure functions in `worker/src/soda-score.ts`. Per drink:

- `R` / `L`: voters whose latest swipe is right / left.
- `likes` / `hates`: voters whose report is like / hate (one report row per voter per drink). `n` = distinct reporters.
- θ is the chance a drinker is glad the drink was bought. Some brands are just worse, so each drink's prior comes from its brand.
- Own evidence `(a_i, b_i)`, no prior: each like adds 1 to `a`, each hate adds 1 to `b`. Right swipes: κ = min(3, 0.2·R) · 3/(3+n), add 0.75κ to `a` and 0.25κ to `b`. Five right swipes weigh one report; the cap is 3 pseudo-counts and fades as reports arrive.
- Left swipes are not evidence ("not a like" includes "haven't had it"). They only lower the tiebreak `appeal = (R+1)/(R+L+2)`.
- Type mean: `m_type = (Σ_type a + c·0.5) / (Σ_type (a+b) + c)`.
- Brand mean, leaving drink i out so its evidence is not counted twice: `m_B(−i) = (Σ_{j∈B, j≠i} a_j + c·m_type) / (Σ_{j∈B, j≠i} (a_j+b_j) + c)`. A single-drink brand gets exactly `m_type`. Brands are keyed by the catalog `brand` string as-is.
- Prior `α0 = k·m_B(−i)`, `β0 = k·(1 − m_B(−i))`. Posterior `α = α0 + a_i`, `β = β0 + b_i`. With no data anywhere this is Beta(1, 1).
- Constants: `c = 4` (`SODA_MEAN_SHRINK`), `k = 2` (`SODA_BRAND_PRIOR_STRENGTH`). Each weekly snapshot records them in `params_json`.
- The ranking key, the Thompson trial draws and the favorites rule all use this posterior.
- Inactive drinks (`sodas.is_active = 0`) are excluded everywhere, including the type and brand means.
- Rank key: posterior mean α/(α+β) desc, then appeal desc. The public leaderboard breaks remaining ties by name, then id. The weekly order list breaks them with a shuffle seeded by `week_start`, so a fresh catalog (all tied) does not buy alphabetically.

### GET /api/soda/catalog
Every active drink, ordered by brand then flavor. Used by the report autocomplete.

**Response 200:**
```json
{ "sodas": [ { "id": 1, "brand": "7UP", "flavor": "Original", "name": "7UP Original", "type": "soda", "image_url": "/api/images/images/<uuid>.jpg" } ] }
```

### GET /api/soda/deck
Up to 20 drinks for this voter's swipe session.

**Headers:** `X-Lunchbench-Session: <uuid>` (optional; without it no drink counts as swiped).

Order: drinks this voter has not swiped come first, least evidence first (`R + L + 5·n`), ties shuffled. Swiped drinks only follow once the unswiped pool is used up, oldest swipe first.

**Response 200:** `{ "sodas": [Soda] }`

### PUT /api/soda/swipes
Records the voter's swipe. A later swipe on the same drink replaces the earlier one.

**Headers:** `X-Lunchbench-Session: <uuid>` (required)

**Request body:**
```json
{ "soda_id": 12, "direction": "right" }
```
`direction` is `"right"` (like) or `"left"` (not a like).

**Response 200:** `{ "ok": true }`

**Errors:** `400 BAD_REQUEST`, `404 NOT_FOUND` (unknown or inactive drink), `429 RATE_LIMITED`

### POST /api/soda/reports
Records that the voter had the drink and liked or hated it. One report per voter per drink: a newer report replaces the older one (latest verdict wins).

**Headers:** `X-Lunchbench-Session: <uuid>` (required)

**Request body:**
```json
{ "soda_id": 12, "verdict": "like" }
```
`verdict` is `"like"` or `"hate"`.

**Response 200:** `{ "ok": true }`

**Errors:** `400 BAD_REQUEST`, `404 NOT_FOUND`, `429 RATE_LIMITED`

### GET /api/soda/leaderboard
Every active drink (sodas and seltzers together), ranked in two groups:

1. drinks with their own evidence (`R + n > 0`: a right swipe or a report), in posterior order;
2. drinks without own evidence (untried, or left swipes only), in posterior order, then appeal.

Left swipes are not evidence, so a left swipe alone does not move a drink into group 1. The brand prior still orders group 2, but an untried flavor of a loved brand never outranks a drink with real evidence. `has_data` (which counts left swipes) only chooses between showing swipe counts and "New soda/seltzer to try". This grouping is a product decision (made by the owner's proxy, open to revisit) and applies to this endpoint only; the weekly order list uses the plain posterior order.

**Response 200:**
```json
{
  "sodas": [
    {
      "rank": 1,
      "id": 12,
      "brand": "Dr Pepper",
      "flavor": "Original",
      "name": "Dr Pepper Original",
      "type": "soda",
      "image_url": "/api/images/images/<uuid>.jpg",
      "right_swipes": 3,
      "left_swipes": 0,
      "likes": 1,
      "hates": 0,
      "reporters": 1,
      "score": 0.66,
      "has_data": true
    }
  ]
}
```
`has_data` is false when the drink has no swipes and no reports. The UI then shows "New soda to try" or "New seltzer to try".

### GET /api/soda/order/latest
**Requires purchaser auth** (`admin` or `purchaser` session).

Returns the latest frozen weekly order list. If no snapshot exists for the current week (fresh deploy, or before Monday's cron), it generates one first with `INSERT OR IGNORE`.

The list is, in order:
1. top 3 sodas (`slot: "top"`);
2. top 3 seltzers (`slot: "top"`);
3. 3 trials (`slot: "trial"`): Thompson-sampled from drinks with fewer than 3 reporters that are not favorites, seeded by `week_start`, avoiding trials from the previous 2 weeks when possible;
4. backups (`slot: "backup"`): the next 2 sodas and 2 seltzers, in rank order.

Favorites (top and backup) fill in tiers, each in rank order:

1. Backed drinks: own evidence (`R + n > 0`), posterior mean at least the type mean `m_type`, and own evidence mean `a/(a+b)` at least `min(m_type, 0.5)`. The own-evidence check stops a strong brand from carrying a drink whose only evidence is a hate into a top slot. It is capped at 0.5 because people tend to report what they liked, which can push `m_type` above 0.75, the own mean of a swipe-only drink.
2. Every other drink except known-bad ones: untried drinks, and drinks with decent own evidence whose posterior sits below `m_type`.
3. Known-bad drinks: own evidence mean below `min(m_type, 0.5)`, such as a drink with only hates.

The bar is the type mean, not the drink's own brand prior: a favorite should beat an average soda (or seltzer), and a strong brand should not hold its own good drinks to a higher bar. Exact score ties use the week-seeded shuffle.
Fewer rows come back when the catalog is too small to fill every slot.
There is no inventory or purchase tracking.

**Response 200:**
```json
{
  "week_start": "2026-11-16",
  "generated_at": "2026-11-16T12:00:03.120Z",
  "items": [
    {
      "rank": 1,
      "slot": "top",
      "soda_id": 12,
      "brand": "Dr Pepper",
      "flavor": "Original",
      "name": "Dr Pepper Original",
      "type": "soda",
      "image_key": "images/<uuid>.jpg",
      "image_url": "/api/images/images/<uuid>.jpg",
      "right_swipes": 3,
      "left_swipes": 0,
      "has_data": true
    }
  ]
}
```
`week_start` is the Monday of the week in America/New_York.

**Errors:** `401 UNAUTHORIZED`

### POST /api/admin/soda/regenerate
**Requires admin auth.** Recomputes the current week's order list and replaces the stored snapshot. Same week and same data give the same list.

**Response 200:** `{ "week_start": "2026-11-16" }`

**Errors:** `401 UNAUTHORIZED`

### Weekly cron
`worker/wrangler.toml` triggers the Worker `scheduled` handler at `0 12 * * 1` (Monday 12:00 UTC, 7–8 am Eastern). It writes the week's snapshot to `soda_buy_lists` with `INSERT OR IGNORE`, so a repeat firing keeps the frozen list.
