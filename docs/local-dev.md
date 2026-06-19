# Local Development

## Prerequisites
- Node.js 20+
- pnpm (`npm i -g pnpm`)
- Wrangler (`npm i -g wrangler`)

## Setup

```bash
git clone https://github.com/amoscao/lunchbench
cd lunchbench
pnpm install
```

## Configure secrets

```bash
cp worker/.dev.vars.example worker/.dev.vars
# Edit worker/.dev.vars and set ADMIN_TOKEN to any random string for local dev
```

## Apply local D1 migrations

```bash
cd worker
npx wrangler d1 execute lunchbench --local --file=../migrations/0001_initial.sql
npx wrangler d1 execute lunchbench --local --file=../migrations/seed.sql
```

## Start the Worker dev server

```bash
cd worker
npx wrangler dev
# Runs on http://localhost:8787
```

## Start the Frontend dev server

In a separate terminal:
```bash
cd frontend
pnpm dev
# Runs on http://localhost:5173
# /api/* proxied to http://localhost:8787
```

## API examples (local)

```bash
# Health check
curl http://localhost:8787/api/health

# Get a matchup
curl http://localhost:8787/api/matchup

# Get leaderboard
curl http://localhost:8787/api/lunches/leaderboard

# Vote (left wins)
curl -X POST http://localhost:8787/api/vote \
  -H "Content-Type: application/json" \
  -d '{"left_lunch_id":1,"right_lunch_id":2,"result":"left_win"}'

# Add a lunch (requires admin token)
curl -X POST http://localhost:8787/api/lunches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-admin-token-here" \
  -d '{"name":"Sushi Roll"}'

# Upload image for lunch #1 (requires admin token)
curl -X POST http://localhost:8787/api/lunches/1/image \
  -H "Authorization: Bearer your-admin-token-here" \
  -F "image=@/path/to/image.jpg"
```
