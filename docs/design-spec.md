# Lunchbench Design Specification

Visual inspiration: minebench.ai — a clean, minimal, benchmark-style interface.
Lunchbench is its lunch-themed cousin: same spirit, original implementation.

---

## 1. Typography

**Font family:** Inter when bundled, otherwise system UI fallback. Do not load fonts from third-party origins.
```
font-family: 'Inter', system-ui, -apple-system, sans-serif;
```

**Scale:**
| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `--text-xs` | 11px | 400 | Meta labels, captions |
| `--text-sm` | 13px | 400 | Secondary text, table cells |
| `--text-base` | 15px | 400 | Body, descriptions |
| `--text-md` | 17px | 500 | Lunch names on cards |
| `--text-lg` | 22px | 600 | Page headings |
| `--text-xl` | 30px | 700 | Hero title |
| `--text-logo` | 20px | 700 | Nav logo |

Letter spacing: slightly tight (`-0.01em`) on headings, normal on body.
Line height: 1.5 on body, 1.2 on headings.

---

## 2. Color Palette

### Light Mode (`:root`)
```css
--bg-primary:   #f7f7f5;   /* warm off-white page background */
--bg-surface:   #ffffff;   /* card and panel background */
--bg-hover:     #f0efed;   /* hover state on rows, soft items */
--text-primary: #111110;   /* near-black, main text */
--text-secondary:#4a4a48;  /* secondary labels */
--text-muted:   #8a8a88;   /* captions, timestamps */
--border:       #e4e4e0;   /* default border */
--border-accent:#c8c8c4;   /* stronger border, table dividers */
--accent:       #d97706;   /* amber — food warmth, buttons */
--accent-hover: #b45309;   /* darker amber on hover */
--accent-text:  #ffffff;   /* text on accent background */
--accent-subtle:#fef3c7;   /* very light amber tint for badges */
--shadow-sm:    0 1px 3px rgba(0,0,0,0.08);
--shadow-md:    0 4px 12px rgba(0,0,0,0.10);
--radius-sm:    6px;
--radius-md:    10px;
--radius-lg:    16px;
```

### Dark Mode (`[data-theme="dark"]`)
```css
--bg-primary:   #111110;
--bg-surface:   #1c1c1a;
--bg-hover:     #242422;
--text-primary: #f0efed;
--text-secondary:#9e9e9a;
--text-muted:   #666663;
--border:       #2a2a28;
--border-accent:#3a3a38;
--accent:       #f59e0b;   /* brighter amber in dark mode */
--accent-hover: #fbbf24;
--accent-text:  #111110;
--accent-subtle:#292310;
--shadow-sm:    0 1px 3px rgba(0,0,0,0.4);
--shadow-md:    0 4px 12px rgba(0,0,0,0.5);
```

---

## 3. Navigation Bar

**Layout:** Full-width, sticky, height 56px. Horizontal flex, items centered.
**Background:** `--bg-surface` with a bottom border `1px solid var(--border)`.
**Left:** Logo text "Lunchbench" in `--text-logo` size, weight 700, color `--accent`.
**Center-right:** Nav links: Home · Leaderboard · Add Lunch
**Far right:** Dark mode toggle button.

**Nav links:**
- `--text-sm`, weight 500
- Color: `--text-secondary`
- Active: color `--text-primary`, with a 2px bottom border in `--accent`
- Hover: color `--text-primary`
- Gap between links: 28px

**Dark mode toggle button:**
- 32×32px, `--radius-sm`
- No background by default, `--border` border
- Hover: `--bg-hover` background
- Shows ☀ (U+2600) in dark mode, ☾ (U+263E) in light mode
- Font size 16px

**Mobile (<640px):** Logo stays left, nav links collapse — show hamburger (☰) that reveals links in a dropdown below the nav bar. Dark mode toggle stays visible.

---

## 4. Cards (Voting)

**Purpose:** Display a single lunch option during voting.

**Dimensions:**
- Desktop: ~380px wide, ~480px tall, side by side with 24px gap
- Mobile: full width, stacked with 16px gap

**Structure:**
```
┌─────────────────────────┐
│                         │
│   IMAGE or PLACEHOLDER  │  ← ~60% of card height
│                         │
├─────────────────────────┤
│  Lunch Name             │  ← --text-md, --text-primary
│  Score: 1042 · 12W 3L 1T │  ← --text-sm, --text-muted
└─────────────────────────┘
```

**Card container:**
- Background: `--bg-surface`
- Border: `1px solid var(--border)`
- Border radius: `--radius-lg`
- Box shadow: `--shadow-md`
- Overflow: hidden
- Cursor: default (card is not clickable — buttons below vote)

**Image area (when image exists):**
- `<img>` with `width:100%, height:100%, object-fit: cover`
- No border radius (image fills the container edge-to-edge at top)

**Placeholder area (no image):**
- Background: `--bg-hover`
- Display: flex, center-center
- Large initial letter of lunch name: `font-size: 72px, font-weight: 700, color: --border-accent`
- Subtle grid pattern via CSS background (1px dotted grid, `--border` color)

**Text area:**
- Padding: 16px 20px
- Name: `--text-md`, `--text-primary`
- Stats: `--text-sm`, `--text-muted`, margin-top 4px

**Hover state on card:**
- Transform: `translateY(-2px)`
- Box shadow: slightly larger
- Transition: 200ms ease

---

## 5. Vote Buttons

Three buttons in a row centered below the two cards.

**Layout:** flex row, gap 12px, justify-content center, margin-top 24px.

**Button styles:**

Left wins button:
- Background: `--accent`
- Color: `--accent-text`
- Border: none
- Padding: 12px 28px
- Border radius: `--radius-md`
- Font: `--text-sm`, weight 600
- Hover: `--accent-hover`, slight scale 1.02
- Active: scale 0.98

Tie button:
- Background: `--bg-surface`
- Color: `--text-secondary`
- Border: `1px solid var(--border-accent)`
- Same padding and radius
- Hover: `--bg-hover`

Right wins button:
- Same as left wins button

**Button labels:**
- Left wins: "← [Left Lunch Name]" (truncated at 20 chars)
- Tie: "Tie"
- Right wins: "[Right Lunch Name] →" (truncated at 20 chars)

**Mobile:** Buttons stack vertically, full width.

**Loading state during vote submission:** All three buttons disabled, opacity 0.6, cursor not-allowed.

---

## 6. Leaderboard

**Layout:** Centered container, max-width 860px, padding 0 20px.

**Page heading:** "Leaderboard" — `--text-lg`, `--text-primary`, margin-bottom 24px.

**Table structure:**
```
Rank  │ [img] Name         │ Rating │ W   │ L   │ T
──────┼─────────────────────┼────────┼─────┼─────┼───
  🥇  │ 🍕 Pizza           │ 1142   │ 24  │  3  │ 1
  🥈  │ 🌮 Tacos           │ 1098   │ 18  │  7  │ 2
   3  │    Salad           │  987   │  9  │ 12  │ 0
```

**Table styling:**
- `border-collapse: collapse`, full width
- Header row: `--text-xs`, weight 600, uppercase, letter-spacing 0.08em, `--text-muted`, `--border-accent` bottom border
- Data rows: `--text-sm`, `--text-primary`
- Row hover: `--bg-hover`, transition 150ms
- Row divider: `1px solid var(--border)`
- Cell padding: 12px 16px

**Rank column:**
- Width: 56px, text-align center
- Rank 1: gold circle badge `#FFD700`, dark text
- Rank 2: silver `#C0C0C0`
- Rank 3: bronze `#CD7F32`
- Rank 4+: plain number, `--text-muted`

**Thumbnail column:**
- 36×36px, `--radius-sm`, `object-fit: cover`
- If no image: same placeholder as card (first letter, `--bg-hover` bg)

**Rating column:**
- Font weight: 600
- Color: `--text-primary`

**W/L/T columns:**
- W: subtle green tint text `#16a34a` (light) / `#4ade80` (dark)
- L: subtle red tint `#dc2626` / `#f87171`
- T: `--text-muted`

**Mobile (<640px):** Collapse W, L, T into a single "W-L-T" column showing "24-3-1".

---

## 7. Add Lunch Form

**Layout:** Centered container, max-width 560px.

**Mode selector:** Three pill/tab buttons at top:
- "New Lunch", "New Lunch + Image", "Add Image to Existing"
- Active: `--accent` background, `--accent-text` color
- Inactive: `--bg-surface` background, `--border` border, `--text-secondary` text
- `--radius-md`, padding 8px 20px, `--text-sm` font

**Form fields:**
- Label: `--text-sm`, weight 500, `--text-primary`, margin-bottom 6px
- Input: full-width, padding 10px 14px, `--radius-sm`, border `1px solid var(--border)`, bg `--bg-surface`, color `--text-primary`
- Focus: border `--accent`, outline none, box-shadow `0 0 0 3px var(--accent-subtle)`

**Image upload area:**
- Dashed border `2px dashed var(--border-accent)`, `--radius-md`
- Padding: 40px 20px
- Center-aligned text: "Drop image here or click to select"
- Color: `--text-muted`, `--text-sm`
- Hover: `--bg-hover` background, border color `--accent`
- When file selected: show preview image (max 200px tall, `--radius-sm`)

**Submit button:**
- Same as Left wins button style above
- Full width, padding 12px
- Loading state: "Submitting…" text, spinner icon (CSS animation), disabled

**Success message:**
- Green banner at top of form: `background: #dcfce7`, `color: #15803d`, `--radius-sm`, padding 12px 16px
- Fades out after 3 seconds (`opacity 0→1→0` animation)

**Error message:**
- Same but: `background: #fee2e2`, `color: #dc2626`
- Stays visible until user takes action

---

## 8. Loading States (Skeleton)

**Skeleton class:**
```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-hover) 25%,
    var(--bg-surface) 50%,
    var(--bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Voting page loading:** Two skeleton cards (same dimensions as real cards, shimmer).
**Leaderboard loading:** 5 skeleton rows, each with rank circle, name bar, and stat bars.
**Add Lunch loading (dropdown):** Single skeleton input-height bar.

---

## 9. Empty States

Centered in the page content area, vertical flex, gap 16px.

- Icon: large emoji relevant to context (🍽 for no lunches, 🏆 for empty leaderboard)
- Heading: `--text-lg`, `--text-primary`
- Subtext: `--text-base`, `--text-muted`
- CTA button: primary button style linking to /add

### Exhausted matchups state

Shown when the user has seen every available pair (`GET /api/matchup` returns `{ "status": "exhausted" }` for this session and vegan mode). Replaces the vote arena — navigation and other UI remain intact.

- Icon: 🎉 or ✅ (celebratory, not an error)
- Heading: "You've seen them all!"
- Subtext: "New matchups may appear as lunches are added. Check back later."
- CTA: secondary button linking to `/leaderboard` — "See the leaderboard"

**Detection**: the server decides exhaustion from acknowledged pairs (`POST /api/matchup/seen`). The client also keeps rendered pairs in localStorage (`lb_seen_pairs`, id order normalized, newest 2000). When `GET /api/matchup` returns a pair already in that set, the client fetches once more and uses the fresh result. It never retries twice. If the retry fails or returns no pair, the original pair renders. This applies to every matchup the home page fetches: the initial load, the prefetched next pair, and the refetch after a vote or skip when the prefetch failed.

**Reset**: no explicit user action needed. When new lunches are added, unseen pairs appear naturally on the next visit.

---

## 10. Error States

Same layout as empty states.

- Icon: ⚠ or ✕ in a colored circle (`#fee2e2` bg, `#dc2626` text)
- Heading: "Something went wrong"
- Subtext: brief description
- Retry button: secondary button style (border only)

---

## 11. Spacing System

Use multiples of 4px:
- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-8`: 32px
- `--space-10`: 40px
- `--space-12`: 48px

Page content padding: 40px top, 20px sides (mobile: 16px sides).
Max content width: 960px, centered.

---

## 12. Transitions and Motion

- Theme toggle: `transition: background-color 0.25s, color 0.25s, border-color 0.25s` on all elements
- Card hover: `transition: transform 0.15s ease, box-shadow 0.15s ease`
- Button hover: `transition: background-color 0.15s, transform 0.1s`
- Vote outcome fade: after voting, cards fade out (`opacity: 0, transition: opacity 0.2s`), then new cards fade in
- No animations that delay user interaction

### Voting transition timing contract

The loading bar animation is exactly **1.5 s** (`bar-fill 1.5s linear forwards` in CSS; `setTimeout(r, 1500)` in JS). The transition to the next matchup must be **instant** the moment the bar fills — no visible pause.

This requires two conditions to be true simultaneously:

1. **Prefetch resolves before the bar fills.** As soon as a matchup renders, `home.ts` fires `nextMatchupPromise = getMatchup(isVeganMode())` in the background. The user has at least their full matchup-viewing time plus up to 1.5 s of vote time for this fetch to complete. `GET /api/matchup` must return in well under 1.5 s. The prefetch also loads and decodes both card images (`preloadMatchupImages`, capped at 3 s), and `renderCard` moves those decoded `<img>` elements into the cards. The decoded images are stored per matchup object, so a re-render (such as a vegan toggle) cannot drop another pair's images. A pair renders with blank images only if the 3 s cap is hit. Initial load waits on the same preload behind the skeleton.

2. **`votePromise` resolves before the bar fills.** `castVote` runs `Promise.all([delay, votePromise])`. `delay` is the 1.5 s timer; `votePromise` is the `POST /api/vote` response. If the POST outlasts the timer, the JS transition is blocked even though the CSS bar is already full. `POST /api/vote` must complete in well under 1.5 s.

After `Promise.all` settles, the code does `next = await (nextMatchupPromise ?? getMatchup(...))`. If `nextMatchupPromise` is already resolved, this `await` returns synchronously and the new matchup appears immediately.

**Implication for backend work:** Any sequential D1 round trips added to `POST /api/vote` or `GET /api/matchup` eat directly into this budget. At ~100–150 ms D1 latency per round trip, the vote POST should target **≤ 6 sequential round trips** to stay comfortably under 1.5 s. `GET /api/matchup` should target **≤ 5 sequential round trips**.

---

## 12a. Sodabench

Mockups live outside the repo; this section is the source of truth.

**Rule: no subtitles or helper text.** Only titles, labels, and controls. No explanatory lines such as "swipe right on sodas you like".

**Nav:** LunchArena (`/`) · SodaArena (`/soda`) · Leaderboard. `/chris` is not in the nav. Internally the feature is still called Sodabench (code, routes, API, tables).

### Swipe deck (`/soda`)
- Max content width 640px.
- Header row: page heading "SodaArena" left, primary button "+ Report a soda" right.
- One continuous feed. There are no decks, no progress counter and no "Start over". It shows the next drink until the voter has swiped every active drink.
- Card: 380px max, 440px tall (380px under 640px wide), `--bg-surface`, `--border-accent` border, `--radius-lg`, `--shadow-md`. Image well 320px (260px) on `--product-bg` (white in both themes, product shots are on white), image `object-fit: contain`. Below: brand (uppercase `--text-sm`, `--text-secondary`) and flavor (`--text-lg`, 700, two lines max).
- Card stack (`frontend/src/components/swipe-stack.ts`): the top card plus two real cards underneath, fully rendered. Each card's `<img>` is created and decoded ahead of time, and images for the next four drinks are decoded beyond that. When the top card leaves, the next card is promoted in place (same element, no re-render) and a new card is appended at the bottom.
- Swipe physics (`frontend/src/utils/swipe-physics.ts`): pointer events, `requestAnimationFrame` and CSS transforms only.
  - **Drag:** the card follows the pointer 1:1 in x and y. Rotation is 0.07°/px, capped at ±20°, and the sign flips when the card is grabbed in its bottom half.
  - **Commit:** |dx| > 35% of the card width, or a flick faster than 0.5 px/ms (measured over the last 100 ms) in the same direction.
  - **Fling:** the card keeps its momentum. It moves at constant velocity, starting at the release speed, keeps its vertical velocity and keeps spinning for a short hop: it ends one card width from rest (at least 0.4 card widths past where it was released) and fades out over the last 65% of the hop. It does not cross the screen. Duration is distance / speed, clamped to 50-260 ms.
  - **Snap back:** a damped spring with a slight overshoot.
  - **Next card:** scales 0.95 → 1 and lifts 10px in proportion to drag progress, then finishes as the top card flies out.
  - **Stamps:** LIKE (`--accent`, top left) and NOPE (`--hate`, top right) fade in and tilt with |dx|.
  - **Input:** the flying card ignores input; the promoted card can be dragged at once, so rapid swipes work. Holding an arrow key counts once (auto-repeat is ignored). A lost pointer capture, or a mouse move with no button held, ends the drag with a snap back. Swipe requests are fire-and-forget, retried once, with a "Swipe not saved" alert on a second failure.
  - **Screen readers:**
    - each card is named "Brand Flavor";
    - a visually hidden polite live region announces the new top drink;
    - the end state is `role="status"`;
    - when the feed empties, focus moves to its title instead of falling to the page body.
  - **Touch:** `touch-action: pan-y` keeps vertical page scroll on phones; pointer capture holds the drag.
  - While on `/soda`, `body` gets `overflow-x: clip` so flung cards never flash a horizontal scrollbar.
- Buttons: two pill buttons in a 2-column grid, 56px tall. Left: surface with `--border-accent`, arrow ←, `aria-label="Swipe left"`. Right: `--accent` fill, arrow →, `aria-label="Swipe right"`. Buttons and arrow keys trigger the same fling with a default velocity and a slight upward arc.
- Keyboard: ← / → swipe while the page is mounted. The listener is removed when the route changes and ignored while the report modal is open or a text field has focus.
- End: after the last drink, a card titled "You've rated everything" ("No drinks yet" if the catalog itself is empty). No subtitle. "Report a soda" stays available.
- `prefers-reduced-motion`: the card fades out in 120 ms. There is no fling, no spring, and no scaling: the cards underneath neither scale with the drag nor animate when promoted.

### Report modal
- Centered dialog (440px, 120px from top) over a `--modal-scrim` backdrop. Below 640px it is a bottom sheet (full width, top corners rounded).
- Title "Report a soda" ("Scan the soda barcode" while the camera is scanning), close button (×, 44px).
- Text field with autocomplete over the full catalog, up to 8 suggestions with a 32px thumbnail. ↑ / ↓ move, Enter picks, Escape closes.
- Search (`frontend/src/soda-search.ts`, local, no request per keystroke):
  - Normalization ignores case, punctuation, apostrophes, accents and the spaces in brand names: "dr pepper" = "Dr. Pepper", "la croix" = "LaCroix", "a and w" / "aw" = "A&W", "barqs" = "Barq's".
  - Every typed word must match the brand, flavor or combined name, in any order. Each typed word needs its own catalog word, so "coka cola" cannot match "Zevia Cola" twice.
  - Words match exactly, by prefix while typing ("str lem"), or inside a longer word for 4+ letters ("berry" finds Raspberry).
  - The type word ("soda"/"seltzer") also matches, but ranks below brand and flavor matches. The seltzer and soda aliases cover searching by type.
  - Typos are forgiven per word: 1 edit (Damerau-Levenshtein) for 4-7 letters, 2 for 8+. Only words no catalog word contains get typo matching, so "diet" never drags in "dirty". A typo against the start of a longer word needs 5+ letters and the same first letter, so "mint" does not match "Vintage".
  - Nicknames live in one exported map, `SODA_ALIASES` ("coke", "dp", "gv", "walmart brand", "sparkling water", "zero", "max", "creme", …). An alias can widen to several brands or flavors and combines with the other words in either order ("diet coke" = "coke diet"). Expansions match exactly or by prefix only. While the last word is still being typed, alias keys that continue it count too, including longer keys ("cok", "doct" → doctor pepper, "fizzy" → fizzy water, "doctor p"). "grapefruit" also finds the grapefruit drinks without the word in their name, after the ones with it: Fresca Original Citrus (Fresca's grapefruit flagship, under Walmart's name) and LaCroix Pamplemousse (#301).
  - Ranking, in order:
    1. type-word-only matches last;
    2. fewer typos;
    3. smaller total edit distance;
    4. more words matched as typed;
    5. better match quality (exact, then prefix, then inside a word);
    6. the first-listed alias expansion ("gv" lists Great Value before Sam's Choice and bettergoods);
    7. shorter names, not counting "Original"/"Pure", so a brand query ("coke", "polar") lists the flagship first;
    8. catalog order.
  - Only the first 8 words of a query count, which keeps every keystroke instant.
- Two 52px buttons: **Hate** (solid red `--report-hate`, white text) on the left and **I like** (solid green `--report-like`, white text) on the right, matching the swipe direction. DOM, visual and tab order agree. Disabled until a suggestion is picked; editing the text disables them again.
- Submitting closes the modal. Nothing else is shown.
- Scan mode (`frontend/src/components/barcode-scanner.ts`):
  - Default only on touch-first devices (`(pointer: coarse)`). Desktop opens in manual mode.
  - Head row: a "Scan barcode" icon button (camera brackets, 44px, `aria-label="Scan barcode"`) left of close. Shown in manual mode when the browser has a camera API and the camera has not failed in this modal.
  - Scan view: live rear-camera preview (`facingMode: environment`, square 1:1 so a barcode fits held horizontally or vertically, `--radius-md`, black behind), a square scan frame (inset 14%, 3px `--accent` border, the area outside dimmed), and a secondary "Select manually" button (always shown). The view is capped at 45vh so the dialog fits short screens. Both decoders read barcodes in either orientation (ZXing `tryRotate`). "I like" and Hate stay visible and disabled.
  - Match: the camera stops; the preview is replaced by the drink image (180px, `--product-bg`) and name (`--text-lg`, 700). "I like" and Hate enable. The title returns to "Report a soda". "Select manually" stays.
  - Unknown code: the code is logged, the camera stops, and the modal switches to manual search with the field focused. A notice above the search (`role="status"`, amber) reads "Barcode not found. Try searching for the drink instead." It clears when scan mode reopens; "Select manually" and a denied camera never show it. The `role="status"` wrapper is always rendered so screen readers announce the text; only the inner box collapses when empty. If the barcode list itself fails to load, the code cannot be looked up and the modal drops to manual search without a notice. The code goes with the manual report so the next scan matches.
  - Permission denied, no camera, no camera API, or no decoder: straight to manual search. No error screen. The "Scan barcode" button hides.
  - The camera stops (every track) on close, match, "Select manually", route change, page hidden (`visibilitychange`; the modal falls back to manual), and errors, including while the decoder is still loading. A camera that ends on its own drops to manual search.
  - Admin "Unknown scans" tab: the Mapped column shows the drink and its source, e.g. "Sprite Original (voter)". Dismiss removes the code's scans and a voter mapping; seed and admin mappings stay. A removed drink is named "<name> (removed)" and a banned one "<name> (banned)". Mapping to a drink that was banned after the tab loaded shows "That drink is banned, so codes cannot be mapped to it. Pick another or unban it first." and reloads the tab.
  - No helper text: only the preview, the frame and labelled controls.

### Auto-ban (#298)
- A drink whose latest report from 5 or more distinct voters is Hate disappears on its own, with no admin step: from the swipe feed, report search, the soda leaderboard, the weekly order list and barcode matches. A scanned banned can goes to manual search.
- The current week's order list on `/chris` loses the drink at once, without a regenerate. The rows below move up one rank; no replacement is added until the next weekly list.
- A ban does not lift on its own: reports on a banned drink are rejected, so they cannot change. Only an admin unban brings it back.
- Admin "Banned drinks" tab: a table with Drink, Hates, Likes and an **Unban** button per row (secondary, small), most hated first; "No banned drinks" when empty. Unban shows "Unbanned!" and reloads the list. An unbanned drink is shown again until its Hate count reaches the count at unban + 5 (at least 5 new Hates, more if earlier haters switch to Like), then it is banned again and returns to the list.
- Pages opened before the ban:
  - Swiping a card of a drink that was banned since the feed loaded counts as done: no "Swipe not saved" alert.
  - Reporting it shows "This drink has been removed" in the modal's error slot, clears the pick and drops the drink from that page's search and scan matches.

### Leaderboard tabs
- Both leaderboards show a tab row above the heading: **Lunch** (`/leaderboard`) and **Soda** (`/leaderboard/soda`). Active tab: `--text-primary` with a 2px `--accent` underline.
- The lunch page heading and table are unchanged.

### Soda leaderboard (`/leaderboard/soda`)
- Heading "Soda Leaderboard". Table columns: Rank (gold/silver/bronze badges as lunch), Drink (40px thumbnail + name), Type tag, Swipes.
- Type tags: Soda (`--bg-hover`), Seltzer (`--tag-seltzer-bg` / `--tag-seltzer-text`).
- Swipes: → right count in accent, ← left count in `--text-secondary`. A drink with no data shows "New soda to try" or "New seltzer to try" in bold.

### Purchaser page (`/chris`)
- Logged out: heading "Purchaser Login", password field, "Log in". The token is kept in localStorage (`lb_purchaser_session_token`), separate from the Add Lunch token.
- Logged in: heading "This Week's Order" with "Week of Mon D" beside it; secondary buttons "Export lunch PDF" and "Log out".
- One ranked table, read-only, 10 rows: 4 sodas, 4 seltzers, one soda trial, one seltzer trial. Columns #, Drink, Type tag, Swipes. Tags: Soda, Seltzer, Trial (`--accent-subtle`).
- No quantities, no summary tiles, no substitutions text.

---

## 13. Implementation Notes

- Use a single `frontend/src/styles/main.css` file for all global CSS variables, resets, and base styles
- Use `data-theme="dark"` on `<html>` for dark mode (not a class)
- All components use CSS custom properties — never hardcode colors
- No CSS framework (no Tailwind, Bootstrap, etc.) — plain CSS only
- No external icon libraries — use Unicode symbols or inline SVG only
- No UI libraries. One exception: the barcode decoder `zxing-wasm` (not a UI library). It is self-hosted (bundled by Vite, never a CDN), pinned to an exact version, and lazy-loaded only when scanning starts on a browser without native `BarcodeDetector`.
- Font loading: same-origin bundled fonts only. The SPA CSP uses `font-src 'self'`.
- Theme boot script must be the FIRST script in `<head>`, before any stylesheet
- Component files export a function that returns an HTMLElement or renders into a container
