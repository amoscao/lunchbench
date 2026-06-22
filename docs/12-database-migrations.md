# Database Migrations

## Goals

Lunchbench uses Cloudflare D1. Migration rules should be simple, explicit, and safe for production data.

The goals are:
- keep schema changes reviewable
- keep local and production schema behavior understandable
- avoid ad hoc production database edits
- keep seed data out of production unless explicitly intended

## Migration Location

SQL migration files live in:

```text
migrations/
```

Current files include:

- `0001_initial.sql`
- `0002_add_description.sql`
- `0003_add_vegan.sql`
- `0004_admin_sessions.sql`
- `0005_glicko.sql`
- `0006_glicko_defaults.sql`
- `0007_session_roles.sql`
- `0008_vegan_leaderboard_index.sql`
- `seed.sql`

`0006_glicko_defaults.sql` repairs the schema defaults for new lunches, resets invalid-only self-match histories to the unrated Glicko baseline, drops copied self-match votes, and shifts obvious valid old-default `1000` starts onto the `1500` scale. It does not replay mixed historical Glicko games. Exact historical replay requires an explicitly approved repair command because the Glicko update is application logic, not SQL.

Migration files should be append-only once merged. If a migration has shipped, create a new migration instead of editing history.

## Local D1

Use local D1 for development:

```bash
cd worker
npx wrangler d1 execute lunchbench --local --file=../migrations/0001_initial.sql
```

Apply later migrations in numeric order.

Seed local data only in local development:

```bash
cd worker
npx wrangler d1 execute lunchbench --local --file=../migrations/seed.sql
```

## Production D1

Production migrations must be deliberate.

Use:

```bash
cd worker
npx wrangler d1 execute lunchbench --remote --file=../migrations/<migration>.sql
```

Before applying production migrations:

1. Review the SQL.
2. Confirm it targets the intended D1 database.
3. Confirm whether the change is additive or destructive.
4. Confirm the deployed Worker code can handle the resulting schema.

Do not apply `seed.sql` to production unless the task explicitly requires production seed data.

## Compatibility Rules

Prefer additive migrations:

- add nullable columns first
- add tables before code depends on them
- backfill separately when needed
- add stricter constraints only after data is clean

Avoid combining destructive schema changes with unrelated feature work.

## PR Expectations

Schema PRs should include:

- migration SQL
- code that reads or writes the new schema
- tests or E2E coverage for the changed behavior
- docs updates if the schema affects API, deployment, or local setup

## Drift

If local, CI, or production schema appears to drift:

1. Stop changing data.
2. Document the observed mismatch.
3. Create or update an issue.
4. Fix through reviewed SQL migration or an explicitly approved repair command.

Do not hide schema repair inside an unrelated PR.
