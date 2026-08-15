# MERAGLYM Deployment & Environment Guide

## Prerequisites
- Node.js >= 20.x
- Python >= 3.13 (`uv` or `pip`)
- Cloudflare Wrangler CLI (optional for direct Edge deploy)

## Build Commands
```bash
# Typecheck
npm run typecheck

# Next.js Static Export Build
npm run build

# Sync build artifacts to static directory
Copy-Item -Recurse -Force "MERAGLYM-main\out\*" "static\"
```

## Cloudflare Pages Deployment
MERAGLYM deploys seamlessly as a Cloudflare Pages project with Edge Functions located in `functions/api/`:
- **Static Assets Directory**: `./static` or `MERAGLYM-main/out`
- **Functions Directory**: `./functions`

## Environment Variables (.env)
```env
ENVIRONMENT=production
DEMO_MODE=false
JOB_TIMEOUT_MS=30000
JOB_MAX_RETRIES=3
JOB_CONCURRENCY=5

# Optional External API Keys
FSSP_API_KEY=
SPIDERFOOT_SERVER_URL=
OPENCTI_URL=
OPENCTI_TOKEN=
```
