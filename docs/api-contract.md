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
Session history is capped (#249): selection reads only the 2000 most recent acknowledged pairs for the session and vegan mode (the size of the frontend's local seen-pairs list). Older pairs can be served again. So `exhausted` stays exact up to 63 lunches in a category (1953 pairs). With more lunches, a session that has seen more than 2000 pairs never gets `exhausted`; it cycles back to its oldest pairs. Acknowledging a pair again (`POST /api/matchup/seen`) refreshes its presentation time, so it moves back into the window and the next-oldest pair drops out.
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

The token must come from a prior successful `GET /api/matchup` response. Duplicate acknowledgements for the same token are treated as success. Acknowledging a pair the session has seen before updates its presentation time (see the history cap above).

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
Neither lunch may be legacy (`is_legacy = 1`). `GET /api/matchup` never serves them, so such a vote comes from a stale tab or a direct API call. It returns 409 `LEGACY_LUNCH` and changes nothing. The current frontend does not retry it or show an error; it moves on to the next matchup. (A tab still running a bundle from before this change retries once and logs a frontend Sentry exception, then also moves on.)

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
- `409 LEGACY_LUNCH` — either lunch is legacy (`is_legacy = 1`)
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

## Rate Limit Monitoring

Every `429 RATE_LIMITED` response (Sodabench writes and `POST /api/admin/verify`) is sent to Sentry as a `warning` event, "Rate limit exceeded" (#262). It is built in one place, `rateLimitedResponse` in `worker/src/rate-limit.ts`, so a new limited route gets it by using that helper.

- Tags: `route` (method and route pattern, e.g. `PUT /api/soda/swipes`), `rate_limit_action` (e.g. `soda_swipe`), `ip_hash`.
- Extra: `count` (requests in the current window), `limit`.
- Grouped per action (fingerprint `rate-limited` + action).
- Throttled: at most one event per action and `ip_hash` per minute in each Worker isolate, so a client looping on a limited route cannot use up the Sentry event quota. Every request still gets its 429. For Sodabench writes `count` keeps rising with each blocked request, so it shows how far over the limit the window is. For `admin_verify` it is the failed-password count, which stops at the limit (blocked attempts are not counted).
- `ip_hash` is the first 16 hex chars of HMAC-SHA-256(client IP, `IP_HASH_KEY`), or `unknown` when the request has no IP header. The raw IP is never sent. If `IP_HASH_KEY` is unset, a random key per Worker isolate is used, so hashes only match within one isolate.
- The Worker Sentry client keeps `sendDefaultPii` off, so Sentry also strips IP headers from request data.
- `beforeSend` (`worker/src/sentry.ts`) scrubs every Worker event: it drops the request body, cookies, `user.ip_address`, and every request header except `Content-Type` and `User-Agent`. Without it the SDK attaches the JSON body (a 429 on `POST /api/admin/verify` would carry the typed password) and keeps headers outside its own IP list, such as `Authorization`, `X-Lunchbench-Session` and `CF-Connecting-IPv6`.
- With `SENTRY_DSN` empty (tests, local dev) the capture is a no-op. A failed report never changes the 429.

The lunch routes have no rate limits (#264).

### Client IP

Per-IP limits, voter barcode learning and `ip_hash` all use one client IP from `getClientIp` (`worker/src/rate-limit.ts`):

1. `X-Lunchbench-Client-IP`, only when the Worker has `PROXY_SECRET` and the request's `X-Lunchbench-Proxy-Secret` matches it. The Pages `/api` proxy sends both (#307).
2. Otherwise `CF-Connecting-IP`, then the first `X-Forwarded-For` entry, then `unknown`.

Clients cannot set these headers through the site: the proxy replaces them. Direct callers of the Worker URL without the secret get rule 2. See `PROXY_SECRET` in `docs/13-environment-and-deployment-config.md`.

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
Writes are rate-limited per client IP: swipes 1200 per hour, reports 60 per hour, unknown scans 60 per hour (`429 RATE_LIMITED`). Voter-learned barcode mappings are capped separately at 20 per hour; over that cap the report still counts but the mapping is skipped (no 429, not reported to Sentry).

**Accepted risk: ballot stuffing.** Voters have no login. The session UUID is client-generated, so one person can clear localStorage (or script fresh UUIDs) and swipe or report the same drink many times. The per-IP rate limits cap the damage, but a shared office IP means they must stay loose. Lunchbench accepts this for an internal office tool. The order list is advisory and Chris can skip any row.
Stuffing also reaches the auto-ban (#298): 5 Hate reports from fresh UUIDs ban a drink for everyone, and it drops off Chris's list at once, mid-week included. The mitigation is the admin "Banned drinks" tab: an admin sees every ban with its hate and like counts, and Unban (`POST /api/admin/soda/banned/:id/unban`) brings the drink back. An unbanned drink stays shown until its Hate count reaches the count at unban + 5 (at least 5 more Hates), so the same stuffing has to be repeated in full.
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
- Left swipes are a non-vote ("not a like" includes "haven't had it"). They change nothing in scoring or ranking: not the score, not the brand or type means, not the tiebreak. They are shown as a count, and a voter's own left swipe removes that drink from their feed.
- A hate report is a full negative: it adds 1 to `b`, exactly as a like adds 1 to `a`.
- Type mean: `m_type = (Σ_type a + c·0.5) / (Σ_type (a+b) + c)`.
- Brand mean, leaving drink i out so its evidence is not counted twice: `m_B(−i) = (Σ_{j∈B, j≠i} a_j + c·m_type) / (Σ_{j∈B, j≠i} (a_j+b_j) + c)`. A single-drink brand gets exactly `m_type`. Brands are keyed by the catalog `brand` string as-is.
- Prior `α0 = k·m_B(−i)`, `β0 = k·(1 − m_B(−i))`. Posterior `α = α0 + a_i`, `β = β0 + b_i`. With no data anywhere this is Beta(1, 1).
- Constants: `c = 4` (`SODA_MEAN_SHRINK`), `k = 2` (`SODA_BRAND_PRIOR_STRENGTH`). Each weekly snapshot records them in `params_json`.
- The ranking key, the Thompson trial draws and the favorites rule all use this posterior.
- Inactive drinks (`sodas.is_active = 0`) are excluded everywhere, including the type and brand means.
- **Auto-ban (#298).** A drink is **banned** when at least `SODA_BAN_HATES = 5` distinct voters' latest report on it is a Hate. Reports from barcode scans and from manual search count alike; likes do not offset hates.
  - The ban is computed from `soda_reports` on every read; only admin unbans are stored. Once banned, a drink stays banned: its reports can no longer change (`409 SODA_BANNED`), so it comes back only through an admin unban (or a direct data fix).
  - **Admin unban.** `POST /api/admin/soda/banned/:id/unban` records the drink's current Hate count in `soda_ban_overrides.hates_at_override`. The drink is then banned only at `hates >= SODA_BAN_HATES + hates_at_override`, i.e. after at least 5 new Hates (more if earlier haters switch to Like, since the threshold is fixed at unban time). A second unban moves the override to the new count.
  - A banned drink disappears everywhere an inactive one does: the swipe feed, catalog and report search, leaderboard, weekly order selection (favorites, trials and the type mean), and `/api/soda/barcodes`. A scanned banned can therefore falls through to manual search and is logged as an unknown scan.
  - It also leaves the current week's order list at once: `GET /api/soda/order/latest` drops banned and inactive drinks from the stored snapshot when it reads it (see that endpoint). Replacements are not recomputed mid-week.
  - Its own evidence still counts toward **its brand's prior**, so a bad brand keeps paying for it.
  - The threshold is recorded in the weekly snapshot's `params_json` as `score.banHates`.
  - Swipe and report history is kept.
  - Writes to a banned drink answer `409 SODA_BANNED`. An unknown or inactive drink answers `404 NOT_FOUND`, even when it is also banned.
- Rank key: posterior mean α/(α+β) desc, then right swipes `R` desc. The public leaderboard breaks remaining ties by name, then id. The weekly order list breaks them with a shuffle seeded by `week_start`, so a fresh catalog (all tied) does not buy alphabetically.

### GET /api/soda/catalog
Every active, not banned drink, ordered by brand then flavor. Used by the report autocomplete.

**Response 200:**
```json
{ "sodas": [ { "id": 1, "brand": "7UP", "flavor": "Original", "name": "7UP Original", "type": "soda", "image_url": "/api/images/images/<uuid>.jpg" } ] }
```

### GET /api/soda/deck
The voter's whole swipe feed: every active, not banned drink this voter has not swiped yet. There are no fixed-size decks. The full catalog is about 115 small rows, so the client loads it once.

**Headers:** `X-Lunchbench-Session: <uuid>` (optional; without it no drink counts as swiped).

Order: a random order weighted toward drinks people like, so voters mostly see promising drinks instead of wading through ones the office dislikes (`worker/src/soda-deck.ts`).

- Weight = brand factor × own factor, capped to `[1/8, 16]` (`deckWeight`).
- Brand factor: `odds(m_B(−i)) / odds(m_type)`, with `odds(x) = x/(1−x)`, the drink's brand prior mean `m_B(−i)` and its type mean `m_type` from the scoring model below. A drink is compared with its own category, so reports on one brand do not reshuffle every other brand or the other type. An untried flavor of a loved brand comes early; one of a hated brand comes late.
- Own factor: `((1 + a)/(1 + b))^2` (`DECK_BIAS_POWER = 2`), where `(a, b)` is the drink's own evidence (`ownEvidence`: reports, plus right swipes as weak likes). It is 1 with no evidence, rises with every like or right swipe and falls with every hate. Raw counts are used rather than the posterior, because the posterior pulls toward the right-swipe mean (0.75): in an office that mostly reports likes, right swipes would otherwise lower a drink's feed weight. Left swipes do not count.
- The caps (`DECK_MIN_WEIGHT`, `DECK_MAX_WEIGHT`) keep the extremes 128x apart, so a hated drink is rare near the top but still turns up early for some voters and can still collect right swipes.
- With no ratings anywhere, every weight is 1 and the order is a uniform shuffle.
- Weighted sampling without replacement (Efraimidis–Spirakis): key `u^(1/w)`, sorted largest first, with `u` from `"<session key>:<drink id>"` hashed and passed through a PRNG finalizer.
- The order is stable across reloads while ratings don't change. The voter's own right swipes and reports count as ratings, so they can shift the rest of their feed a little. Without a session header, the order is random per request. Swiped drinks never come back. Once every drink is swiped, the list is empty.

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

**Errors:** `400 BAD_REQUEST`, `404 NOT_FOUND` (unknown or inactive drink), `409 SODA_BANNED` (the drink is banned), `429 RATE_LIMITED`

### POST /api/soda/reports
Records that the voter had the drink and liked or hated it. One report per voter per drink: a newer report replaces the older one (latest verdict wins).

**Headers:** `X-Lunchbench-Session: <uuid>` (required)

**Request body:**
```json
{ "soda_id": 12, "verdict": "like", "barcode": "0012345678905" }
```
`verdict` is `"like"` or `"hate"`.
`barcode` is optional: the unknown code this voter scanned just before picking the drink manually. It must be a valid UPC/EAN (normalized as in Barcodes below); an invalid one is `400`.

With `barcode`, after the report is saved:

1. The voter's latest unresolved `soda_unknown_scans` row for that code gets `resolved_soda_id` = the reported drink (`resolved_by = 'voter'`).
2. Only if step 1 found a row, the code is mapped to the drink in `soda_barcodes` with `source = 'voter'`, unless it is already mapped. First mapping wins; an admin can override it. A report cannot map a code its voter never logged as unknown.
3. One agreeing session is enough. Lunchbench does not wait for 2 sessions to agree: voters are an honest office crowd, most codes would otherwise never get mapped, and a wrong mapping is visible on the admin list and fixable there. The per-IP cap above limits abuse.

**Response 200:** `{ "ok": true }`. With `barcode`: `{ "ok": true, "barcode_soda_id": 12 }`, the drink the code maps to now (`null` if it stays unmapped). The client adds it to its local lookup so a re-scan matches.

**Errors:** `400 BAD_REQUEST`, `404 NOT_FOUND` (unknown or inactive drink), `409 SODA_BANNED` (the drink is banned; the report is rejected, not stored), `429 RATE_LIMITED`

### Barcodes

The report modal can scan a can's barcode (see `docs/design-spec.md`). Decoding runs on the device; no image or frame ever leaves it. The server only receives the decoded digit string.

Every code is stored and compared as a 13-digit GTIN: UPC-E is expanded to UPC-A, then UPC-A and EAN-8 are zero-padded on the left. The GTIN check digit must be valid. A UPC-E from a decoder may arrive short: 6 digits (number system 0 assumed, check digit computed) or 7 digits (six digits + check with number system 0 when that check is valid, else number system + six digits with the check computed). Short forms are only read as UPC-E when `format` is `upc_e`; a computed check digit cannot catch a misread. The same rules live in `worker/src/barcode.ts` and `frontend/src/utils/barcode.ts`.

### GET /api/soda/barcodes
Every barcode mapped to an active, not banned drink. The client fetches it once per page load and looks scans up locally; there is no request per scan.

**Response 200:** `{ "barcodes": [ { "code": "0049000006346", "soda_id": 12 } ] }` (`Cache-Control: no-cache`)

### POST /api/soda/unknown-scans
Logs a scanned code that matched no known drink, for the admin "Unknown scans" list.

**Headers:** `X-Lunchbench-Session: <uuid>` (required)

**Request body:**
```json
{ "barcode": "0012345678905", "format": "ean_13" }
```
`format` is the decoder's symbology: `upc_a`, `upc_e`, `ean_13` or `ean_8`. It decides whether a code under 12 digits is UPC-E or EAN-8. The body is the barcode string and format only; there is no field for image data.

**Response 200:** `{ "ok": true, "code": "0012345678905" }` (the normalized code)

**Errors:** `400 BAD_REQUEST` (no session, bad format, not digits, bad length or check digit), `429 RATE_LIMITED`

Rows older than 180 days are deleted by the weekly cron.

### GET /api/soda/leaderboard
Every active, not banned drink (sodas and seltzers together), ranked in two groups:

1. drinks with their own evidence (`R + n > 0`: a right swipe or a report), in posterior order;
2. drinks without own evidence (untried, or left swipes only), in posterior order, then name and id.

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

The list has 10 rows, in order:
1. top 4 sodas (`slot: "top"`);
2. top 4 seltzers (`slot: "top"`);
3. one soda trial, then one seltzer trial (`slot: "trial"`).

Each type's trial is picked from that type's drinks that are not already listed, falling through these tiers so the trial changes every week:

1. trial-eligible drinks (fewer than 3 reporters) not trialed in the previous 2 weeks;
2. any drink not trialed in the previous 2 weeks (the eligible pool is exhausted);
3. trial-eligible drinks trialed recently;
4. the best-scored drink left.

Tiers 1-3 are Thompson-sampled with the RNG seeded by `week_start`, so a given week is reproducible. A type never gets two trials; if it has no drink left at all, its trial row is omitted.

The snapshot is frozen, but each read drops items whose drink is now banned or inactive (one status query) and renumbers `rank` 1..n. The other rows keep their places; nothing is recomputed to replace the dropped drink until the next snapshot (Monday cron or `POST /api/admin/soda/regenerate`).

There are no backup rows. Snapshots stored before backups were removed may still contain `slot: "backup"` items. They were the last ranks, so this endpoint drops them on read and ranks stay contiguous. Such a snapshot keeps its old 3 + 3 + 3 shape until the next Monday cron. To switch the current week right away, an admin can call `POST /api/admin/soda/regenerate`.

Favorites fill in tiers, each in rank order:

1. Backed drinks: own evidence (`R + n > 0`), posterior mean at least the type mean `m_type`, and own evidence mean `a/(a+b)` at least `min(m_type, 0.5)`. The own-evidence check stops a strong brand from carrying a drink whose only evidence is a hate into a top slot. It is capped at 0.5 because people tend to report what they liked, which can push `m_type` above 0.75, the own mean of a swipe-only drink.
2. Every other drink except known-bad ones: untried drinks, and drinks with decent own evidence whose posterior sits below `m_type`.
3. Known-bad drinks: own evidence mean below `min(m_type, 0.5)`, such as a drink with only hates.

The bar is the type mean, not the drink's own brand prior: a favorite should beat an average soda (or seltzer), and a strong brand should not hold its own good drinks to a higher bar. Exact score ties use the week-seeded shuffle.
Fewer rows come back when the catalog is too small to fill every slot. `params_json` records the counts (`topPerType: 4`, `trialsPerType: 1`).
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

### GET /api/admin/soda/unknown-scans
**Requires admin auth.** The unknown-scan log grouped by code. Unmapped codes first, then most recently seen. Never returns session keys, only distinct-voter counts.

**Response 200:**
```json
{
  "codes": [
    {
      "code": "0012345678905",
      "formats": ["ean_13"],
      "scans": 3,
      "voters": 2,
      "first_seen": "2026-11-16 14:03:22",
      "last_seen": "2026-11-16 15:10:04",
      "picks": [ { "soda_id": 12, "name": "Zevia Cola", "count": 2 } ],
      "mapped_soda_id": 12,
      "mapped_name": "Zevia Cola",
      "mapped_source": "voter"
    }
  ]
}
```
`first_seen` / `last_seen` are SQLite UTC timestamps. `picks` counts scans that voters resolved by reporting a drink manually; admin mappings are not picks. `mapped_source` is `seed`, `voter` or `admin` (null when unmapped). The admin tab shows it next to the drink. A drink that is no longer active (`is_active = 0`) is named with a ` (removed)` suffix in `picks[].name` and `mapped_name`; a banned one gets ` (banned)`. The admin tab never preselects either, because neither is in the catalog it maps to.

**Errors:** `401 UNAUTHORIZED`

### POST /api/admin/soda/barcodes
**Requires admin auth.** Maps a code to an active, not banned drink with `source = 'admin'`, replacing any earlier mapping, and marks that code's unresolved scans resolved (`resolved_by = 'admin'`).

**Request body:** `{ "code": "012345678905", "soda_id": 12 }` (any valid UPC/EAN; stored normalized)

**Response 200:** `{ "code": "0012345678905", "soda_id": 12 }`

**Errors:** `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `404 NOT_FOUND` (unknown or inactive drink), `409 SODA_BANNED` (banned drink)

### GET /api/admin/soda/banned
**Requires admin auth.** Active drinks currently auto-banned (see Scoring, "Auto-ban"), most hated first. `hates` and `likes` are all-time counts, including Hates from before an earlier unban.

**Response 200:**
```json
{ "banned": [ { "id": 12, "name": "Coca-Cola Original", "hates": 5, "likes": 2 } ] }
```

**Errors:** `401 UNAUTHORIZED`

### POST /api/admin/soda/banned/:id/unban
**Requires admin auth.** Lifts a drink's auto-ban. Stores the drink's current Hate count in `soda_ban_overrides` (one row per drink, replaced on a later unban), so the drink is shown again until its Hate count reaches that count + `SODA_BAN_HATES` (5): at least 5 new Hates from distinct voters, more if earlier haters switch to Like.

**Response 200:** `{ "id": 12, "hates_at_override": 5 }`

**Errors:** `400 BAD_REQUEST` (id not a positive integer), `401 UNAUTHORIZED` (no admin session; a purchaser session is not enough), `404 NOT_FOUND` (unknown, inactive or not currently banned)

### DELETE /api/admin/soda/unknown-scans/:code
**Requires admin auth.** Dismisses a code (for example a non-soda barcode a voter then "reported" as a drink): deletes its rows from the log and its `voter` mapping, if any. The next scan of the code is unknown again, so it is logged again. `seed` and `admin` mappings stay; to change one, map the code to another drink.

**Response 200:** `{ "dismissed": 3, "voter_mapping_removed": true }`

**Errors:** `400 BAD_REQUEST`, `401 UNAUTHORIZED`

### Weekly cron
`worker/wrangler.toml` triggers the Worker `scheduled` handler at `0 12 * * 1` (Monday 12:00 UTC, 7–8 am Eastern). It writes the week's snapshot to `soda_buy_lists` with `INSERT OR IGNORE`, so a repeat firing keeps the frozen list. It then deletes `soda_unknown_scans` rows older than 180 days.
