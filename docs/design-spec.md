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

Shown when the user has seen every available pair (seen-pairs localStorage set covers all combinations in the current lunch pool). Replaces the vote arena — navigation and other UI remain intact.

- Icon: 🎉 or ✅ (celebratory, not an error)
- Heading: "You've seen them all!"
- Subtext: "New matchups may appear as lunches are added. Check back later."
- CTA: secondary button linking to `/leaderboard` — "See the leaderboard"

**Detection**: the prefetch IIFE in `home.ts` tries up to 3 `GET /api/matchup` calls. If every returned pair is in the seen-pairs set, exhaustion is declared and this state is rendered instead of a seen pair.

**Reset**: no explicit user action needed. When new lunches are added (expanding the pair pool beyond what localStorage covers), unseen pairs will appear naturally on the next visit.

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

1. **Prefetch resolves before the bar fills.** As soon as a matchup renders, `home.ts` fires `nextMatchupPromise = getMatchup(isVeganMode())` in the background. The user has at least their full matchup-viewing time plus up to 1.5 s of vote time for this fetch to complete. `GET /api/matchup` must return in well under 1.5 s.

2. **`votePromise` resolves before the bar fills.** `castVote` runs `Promise.all([delay, votePromise])`. `delay` is the 1.5 s timer; `votePromise` is the `POST /api/vote` response. If the POST outlasts the timer, the JS transition is blocked even though the CSS bar is already full. `POST /api/vote` must complete in well under 1.5 s.

After `Promise.all` settles, the code does `next = await (nextMatchupPromise ?? getMatchup(...))`. If `nextMatchupPromise` is already resolved, this `await` returns synchronously and the new matchup appears immediately.

**Implication for backend work:** Any sequential D1 round trips added to `POST /api/vote` or `GET /api/matchup` eat directly into this budget. At ~100–150 ms D1 latency per round trip, the vote POST should target **≤ 6 sequential round trips** to stay comfortably under 1.5 s. `GET /api/matchup` should target **≤ 5 sequential round trips**.

---

## 13. Implementation Notes for Codex

- Use a single `frontend/src/styles/main.css` file for all global CSS variables, resets, and base styles
- Use `data-theme="dark"` on `<html>` for dark mode (not a class)
- All components use CSS custom properties — never hardcode colors
- No CSS framework (no Tailwind, Bootstrap, etc.) — plain CSS only
- No external icon libraries — use Unicode symbols or inline SVG only
- Font loading: same-origin bundled fonts only. The SPA CSP uses `font-src 'self'`.
- Theme boot script must be the FIRST script in `<head>`, before any stylesheet
- Component files export a function that returns an HTMLElement or renders into a container
