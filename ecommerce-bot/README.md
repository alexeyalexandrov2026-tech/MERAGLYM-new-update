# Shopbot — a continuously running e-commerce service

A production-shaped storefront backend for **lawful general merchandise**
(the sample catalog is specialty coffee, brewing equipment and homeware).
It runs 24/7 as two processes: a FastAPI web tier and a background worker.

```
Browser ──► /api/catalog          browse
        ──► /api/checkout/sessions ──► Stripe Checkout (hosted) ──► buyer pays
                                                │
Stripe  ──► /webhooks/stripe ◄──────────────────┘  signed event
             │ verify signature → record event (unique id) → apply side effects
             ▼
        orders.paid + inventory committed + receipt row   (one transaction)
             │
Worker  ─────┴──► drain outbox → SMTP → receipt delivered (retry + backoff)
                  expire stale reservations · replay failed webhooks
```

**Card data never touches this service.** Payment is collected on the
provider's hosted page; the only payment identifiers stored are opaque
provider references (session, payment intent, charge, refund).

---

## Lawful-use boundary

This codebase is scoped to ordinary, unrestricted consumer goods. It
deliberately does **not** include — and must not be extended with — support
for controlled substances, prescription medicines, weapons, stolen goods, or
any other unlawful product, nor any feature intended to evade law enforcement,
payment-network rules, age restrictions, or regulatory requirements.

If your catalog includes age-restricted or licensed goods (alcohol, tobacco,
firearms, pharmacy), this design is **not sufficient as-is**: those categories
require age and identity verification, jurisdiction-specific licensing, and
payment-provider pre-approval that are out of scope here. Consult your payment
provider's prohibited-business list and your own counsel first.

---

## Quick start (local, no real payments)

```bash
cp .env.example .env          # then edit; the fake provider needs no keys
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

# Offline mode: fake payment provider, receipts printed to the log.
export PAYMENT_PROVIDER=fake EMAIL_BACKEND=console
export DATABASE_URL="postgresql+asyncpg://shopbot:shopbot@localhost:5432/shopbot"

alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload      # terminal 1
python -m app.worker               # terminal 2
```

The development admin key is printed at startup when `ENVIRONMENT=development`
and `ADMIN_API_KEY` is unset. Interactive docs are at `/docs` (disabled in
production).

Run the tests — no network, no credentials, no database server needed:

```bash
pytest -q          # 87 tests
ruff check app tests
```

---

## Stripe setup (PROVIDER-SPECIFIC CONFIGURATION REQUIRED)

Everything below is done in the Stripe Dashboard; none of it can be inferred
from this code.

1. **Keys.** Developers → API keys. Use `sk_test_…` in sandbox. The app
   refuses to boot in production with a test key.
2. **Webhook endpoint.** Developers → Webhooks → *Add endpoint*, pointing at
   `https://your-domain/webhooks/stripe`. Copy the signing secret (`whsec_…`)
   into `STRIPE_WEBHOOK_SECRET`.
3. **Subscribe to these event types** — the handler acts on exactly these:

   | Event | Effect |
   |---|---|
   | `checkout.session.completed` | confirm payment (only when `payment_status` is `paid`) |
   | `checkout.session.async_payment_succeeded` | confirm a delayed payment method |
   | `checkout.session.async_payment_failed` | mark failed, release stock |
   | `checkout.session.expired` | expire order, release stock |
   | `payment_intent.payment_failed` | mark failed, release stock, notify buyer |
   | `charge.refunded` | apply refund, restock on a full refund |
   | `charge.refund.updated` / `refund.updated` | track a refund that later fails |

   Anything else is recorded as `ignored` and has no effect.
4. **Local testing** with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:8000/webhooks/stripe
   stripe trigger checkout.session.completed
   ```
   `stripe listen` prints its own `whsec_…`; use that one locally.

### Email (PROVIDER-SPECIFIC CONFIGURATION REQUIRED)

`EMAIL_BACKEND=smtp` works with any SMTP submission endpoint — Amazon SES,
Postmark, SendGrid, Mailgun, Resend, or your own MTA. You must separately
configure **SPF, DKIM and DMARC** for the sending domain, or receipts will land
in spam.

---

## How the guarantees are implemented

### Payments are never double-processed

Three independent layers, because providers redeliver events freely:

1. `webhook_events` has a unique index on `(provider, provider_event_id)`.
   The insert *is* the dedupe primitive — a duplicate raises, is caught, and
   returns `200 {"status":"duplicate"}` without running any side effect.
2. Every side effect is independently idempotent: order transitions are
   guarded by an explicit state machine (`ORDER_TRANSITIONS`), stock movements
   by the order's `inventory_state`, receipts by the outbox `dedupe_key`. Two
   *different* event ids carrying the same fact still produce one outcome.
3. Amounts are verified: an event whose `amount_total` differs from the order
   total never marks the order paid.

### Money is never lost or invented

- All amounts are integer minor units. No floats anywhere in the money path.
- Prices come from the database. The request carries SKUs and quantities only;
  unknown fields are rejected (`extra="forbid"`), so a tampered payload cannot
  set a price.
- Refund bookkeeping reads Stripe's *cumulative* `amount_refunded`, so a
  replayed refund event cannot double-count. A refund that later fails
  (`refund.updated` → `failed`) releases the balance again.

### Stock is never leaked or oversold

`reserved → committed | released | restocked`, with the state stored on the
order so every transition is replay-safe. Reserved-but-unpaid stock is
released by the worker when the checkout session expires. Row locks
(`SELECT … FOR UPDATE`, ordered by id to avoid deadlocks) serialise concurrent
checkouts on PostgreSQL.

### Receipts survive an email outage

Marking an order paid and queueing its receipt happen in **one transaction**
(transactional outbox), so the two can never disagree. The worker delivers with
full-jitter exponential backoff (30s → 12h, 8 attempts), distinguishes
permanent SMTP 5xx failures (dead-letter immediately) from transient 4xx, and
exposes dead letters at `GET /admin/outbox?status=dead_letter` with a
`POST /admin/outbox/{id}/retry` to requeue. **A receipt failure never unwinds a
payment.**

### Nothing runs unauthenticated that shouldn't

- `/admin/*` requires `X-Admin-Api-Key` (or `Authorization: Bearer`), compared
  in constant time, rate limited *before* the comparison so it cannot be used
  as a brute-force oracle, and written to `admin_audit_log` with request id and
  source IP.
- Buyers read their own order with an unguessable 32-byte token; a wrong token
  is indistinguishable from a missing order.
- `X-Forwarded-For` is only trusted when `TRUSTED_PROXY_HOPS > 0`.
- Errors return a fixed shape; stack traces are logged, never returned.
  Logs redact `authorization`, `stripe-signature`, tokens and card-shaped keys.

---

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | — | liveness (touches nothing) |
| GET | `/readyz` | — | readiness: DB + provider config |
| GET | `/metrics` | — | Prometheus text exposition |
| GET | `/api/catalog/products` | — | browse, search, paginate |
| GET | `/api/catalog/products/{slug}` | — | product detail |
| POST | `/api/checkout/sessions` | — | create order → hosted checkout URL |
| GET | `/api/orders/{id}?token=` | token | buyer order status |
| POST | `/webhooks/stripe` | signature | payment events |
| GET | `/admin/orders` | admin | list/filter orders |
| POST | `/admin/orders/{id}/fulfillment` | admin | mark in progress/shipped/delivered |
| POST | `/admin/refunds` | admin | full or partial refund |
| POST | `/admin/products` · `PATCH /admin/products/{id}` | admin | catalog |
| POST | `/admin/products/{id}/stock` | admin | stock adjustment |
| GET | `/admin/outbox` · `POST /admin/outbox/{id}/retry` | admin | receipt queue |

Send `Idempotency-Key` on `POST /api/checkout/sessions`. Without one, a digest
of the request body is used, so a double-clicked buy button still creates one
order.

---

## Deployment (24/7)

### Docker Compose (self-hosted)

```bash
cp .env.example .env    # fill in every <PLACEHOLDER>
docker compose up -d --build
docker compose exec web python -m app.seed    # optional sample catalog
docker compose logs -f web worker
```

Five services: `db`, `redis`, one-shot `migrate`, `web` (gunicorn + uvicorn
workers), `worker`, and a nightly `backup`. `restart: unless-stopped` is what
survives crashes and host reboots. The database is not published to the host.

### Managed platforms

Any container host works; the shape is always the same — **one web service,
one worker service, one migration step that runs before the web service
starts**.

- **Fly.io** — `fly launch`, then a `[processes]` block with
  `app = "gunicorn app.main:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000"`
  and `worker = "python -m app.worker"`; put `alembic upgrade head` in
  `[deploy] release_command`; secrets via `fly secrets set`.
- **Render** — a Web Service and a Background Worker from the same image;
  Pre-Deploy Command `alembic upgrade head`; secrets in an environment group.
- **AWS ECS/Fargate** — two services on one task definition family, migrations
  as a one-off task in the pipeline; secrets from Secrets Manager injected as
  `valueFrom`.
- **Kubernetes** — a Deployment for web (`/healthz` liveness, `/readyz`
  readiness), a Deployment for the worker, migrations as a `Job` in a Helm
  `pre-upgrade` hook. Set `terminationGracePeriodSeconds: 45`.

### Operational settings that matter

| Concern | Setting |
|---|---|
| More than one web replica | **`REDIS_URL` must be set**, or each process enforces its own rate limit |
| Behind a load balancer | `TRUSTED_PROXY_HOPS=1` |
| Worker scaling | Safe to run several: claims use `FOR UPDATE SKIP LOCKED` |
| Graceful drain | `tini` forwards SIGTERM; gunicorn `--graceful-timeout 30`; the worker finishes its pass and exits |
| Restart | `restart: unless-stopped` / platform restart policy |

### Monitoring

Scrape `/metrics`. Alert on:

- `shopbot_outbox_messages_total{status="dead_letter"} > 0` — receipts are not
  reaching customers.
- `shopbot_outbox_messages_total{status="failed"}` rising — email provider
  trouble.
- `shopbot_orders_total{status="pending_payment"}` growing without a matching
  rise in `paid` — checkout is broken.
- `/readyz` returning 503.
- Log events worth alerting on: `webhook_verification_failed` (a spike means
  either a rotated secret or someone probing), `webhook_amount_mismatch`
  (investigate every one), `webhook_processing_failed`, `admin_auth_failed`.

### Backups and rollback

Backups: the `backup` service takes a nightly `pg_dump -Fc` with 14-day local
retention. **Copy them off-host** (S3/GCS with object-lock) and restore-test
them quarterly — an untested backup is a guess.

```bash
# Restore
docker compose stop web worker
docker compose exec -T db pg_restore -U shopbot -d shopbot --clean --if-exists < backups/<file>.dump
docker compose start web worker
```

Rollback:

1. **Application only** (no migration in the release) — redeploy the previous
   image tag. Safe at any time; the worker and webhooks are idempotent.
2. **With a migration** — write migrations to be backward compatible for one
   release (add columns nullable, never drop or rename in the same deploy that
   changes code). Then a code rollback needs no schema rollback. If you must
   reverse the schema, `alembic downgrade -1` *after* rolling back the code.
3. **Never** roll back past a migration that has already processed live
   payments without restoring from a backup taken at that point.

While rolled back, webhook events keep arriving and are banked in
`webhook_events`; the worker replays any whose handlers failed once the fixed
version is deployed.

---

## Data retention

`webhook_events.payload` stores the verified provider event so a failed handler
can be replayed without asking Stripe to redeliver. It contains buyer email and
address. Set a retention job (not included) to purge rows older than your
policy — 90 days is a common choice — along with `admin_audit_log`. Orders
themselves are usually kept for the statutory tax-record period.

---

## Production hardening checklist

Before taking real money:

- [ ] Replace every `<PLACEHOLDER>` in `.env`; move secrets into a secrets
      manager rather than a file.
- [ ] `ENVIRONMENT=production`, `PUBLIC_BASE_URL` on https, live Stripe keys.
- [ ] `ADMIN_API_KEY` ≥ 32 random chars; rotate on a schedule; give operators
      individual keys via a proper identity provider rather than one shared key.
- [ ] Pin exact dependency versions (`pip-compile`) and enable Dependabot.
- [ ] `REDIS_URL` set if more than one web replica.
- [ ] `TRUSTED_PROXY_HOPS` matched to your actual proxy depth.
- [ ] TLS terminated in front; HSTS added at the edge.
- [ ] Database: TLS (`?ssl=require`), least-privilege role (no `SUPERUSER`,
      no DDL at runtime), `statement_timeout` set.
- [ ] Off-host, encrypted, restore-tested backups.
- [ ] Alerts wired for every metric and log event listed above.
- [ ] Load test checkout under concurrency to confirm reservations hold.
- [ ] Legal/compliance: terms of sale, privacy notice, refund and cancellation
      policy, tax calculation and remittance, and confirmation that your goods
      are permitted under your payment provider's prohibited-business list.

### Known gaps (deliberate, not oversights)

- **Tax** is not calculated. Add Stripe Tax or your own engine before selling
  across jurisdictions.
- **Shipping** is a flat fee (`SHIPPING_FLAT_MINOR`); real rating needs a
  carrier integration.
- **Admin auth** is a single shared key — appropriate for one operator, not a
  team. Replace with OIDC/SSO and per-user roles as you grow.
- **Multi-currency** is per-product and single-currency per order; there is no
  FX conversion.
- **The webhook payload** is retained; see *Data retention* above.
