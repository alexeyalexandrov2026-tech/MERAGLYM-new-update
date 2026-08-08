# MERAGLYM

MERAGLYM is a Next.js 16 / Prisma 7 / PostgreSQL application with a Python ETL and OSINT worker.

## Requirements

- Node.js 22.12+
- npm 10+
- Docker Desktop with Compose
- Python 3.14+ for local worker development

## Run the complete stack

```bash
docker compose up --build
```

The Compose startup order is:

1. PostgreSQL starts and becomes healthy.
2. Prisma applies migrations.
3. Next.js starts.
4. The Python worker starts and processes pending jobs.

Open `http://localhost:3000`.

## Useful checks

```bash
docker compose ps
docker compose logs --tail=200 db
docker compose logs --tail=200 migrate
docker compose logs --tail=200 web
docker compose logs --tail=200 worker
```

Health endpoint:

```text
http://localhost:3000/api/health
```

## Local Next.js development

Create `.env` from `.env.example`, then install dependencies:

```bash
npm ci
npm run db:generate
npm run dev
```

Database migrations:

```bash
npm run db:migrate
npm run db:seed
```

Static checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Python worker

```bash
cd python
uv sync
uv run pytest
python -m meraglym.etl.worker
```

The worker requires `DATABASE_URL`.

## Environment

`.env.example` is safe to commit. Real `.env` files and secrets are ignored by Git.

For Docker Compose, PostgreSQL credentials can be overridden with:

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
POSTGRES_PORT
WEB_PORT
```
