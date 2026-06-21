# Secrets

## ADMIN_TOKEN
- **Purpose**: Protects `POST /api/admin/verify` (used to mint `SESSION_TOKEN`)
- **Generate**: `openssl rand -hex 32`
- **Add as Worker secret**: `npx wrangler secret put ADMIN_TOKEN` (enter value when prompted)
- **Add to `.dev.vars`**: `ADMIN_TOKEN=<value>` (never commit this file)
- **Do NOT share** this value publicly

## CLOUDFLARE_API_TOKEN
- **Purpose**: Allows CI/CD (GitHub Actions) to deploy the Worker and Pages
- **Create at**: https://dash.cloudflare.com/profile/api-tokens
- **Required permissions**: Workers Scripts (Edit), Cloudflare Pages (Edit), D1 (Edit), R2 (Edit)
- **Add to GitHub**: Settings -> Secrets -> Actions -> CLOUDFLARE_API_TOKEN

## CLOUDFLARE_ACCOUNT_ID
- **Purpose**: Identifies your Cloudflare account in CI/CD
- **Find at**: dash.cloudflare.com -> right sidebar -> Account ID
- **Add to GitHub**: Settings -> Secrets -> Actions -> CLOUDFLARE_ACCOUNT_ID

## Security Notes
- Never commit .dev.vars
- Never commit actual secret values to any file
- Rotate API tokens if accidentally exposed
