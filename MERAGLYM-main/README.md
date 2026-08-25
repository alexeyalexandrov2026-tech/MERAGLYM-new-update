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

## Cloudflare production topology

The Docker Compose stack above (PostgreSQL + Python worker) is the **local**
development path. The deployed site at `meraglym.pages.dev` runs on a different
stack, and the two do not share a database:

| Piece | Where it runs | In this repo? |
| :--- | :--- | :---: |
| Static UI + `/api/*` | Cloudflare Pages Functions (`functions/api/`) | yes |
| `Job` / `Node` storage | Cloudflare D1 (`meraglym-db`) | schema only |
| Job execution | `meraglym-consumer` Worker, queue `meraglym-jobs` | **no** |

`POST /api/jobs` inserts a `QUEUED` row into D1 and sends a message to the
`meraglym-jobs` queue. The `meraglym-consumer` Worker consumes it roughly 5-6
seconds later, runs the adapter, and writes `COMPLETED` or `FAILED` back to the
same row. The UI polls `GET /api/jobs/:id` until the status settles.

Two consequences worth knowing before changing job handling:

- **The consumer's source is not in this repository.** It registers a fixed set
  of nine adapter ids (see `LIVE_ADAPTER_IDS` in `src/lib/adapterRouting.ts`) and
  rejects any other job `type` with `ADAPTER_NOT_FOUND`. Adding an adapter to
  `src/lib/adapters/registry.ts` does **not** make it available in production —
  that requires redeploying the consumer. `tests/deployedAdapterContract.test.ts`
  pins routing against the validators the consumer actually enforces.
- **`queues.producers` in `wrangler.jsonc` is load-bearing.** Removing it
  silently detaches the consumer and leaves every job stuck in `QUEUED`.

The Python worker in `python/` polls PostgreSQL and is unrelated to this
pipeline; it never sees D1 jobs.
