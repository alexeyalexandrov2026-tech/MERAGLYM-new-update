# MERAGLYM API Documentation

## Overview
MERAGLYM exposes an enterprise-grade REST and Serverless Edge API for OSINT intelligence workflows, telemetry, jobs scheduling, and threat intelligence graph correlation.

---

## Endpoints

### 1. Health & Observability
- **`GET /api/health`**
  - Returns overall system status, D1 database latency, AI engine status, and adapter counts.
- **`GET /api/health/live`**
  - Liveness probe returning `{"status": "alive"}`.
- **`GET /api/health/ready`**
  - Readiness probe validating active database connection.
- **`GET /api/health/adapters`**
  - Detailed health and credential requirements breakdown across all 21 intelligence adapters.

### 2. Job Lifecycle Engine
- **`POST /api/jobs`**
  - Creates and enqueues a new asynchronous or real-time OSINT task.
  - Headers: `Idempotency-Key` (optional, prevents duplicate jobs).
  - Body:
    ```json
    {
      "type": "phone_person_correlator",
      "payload": {
        "target": "+79231054928"
      }
    }
    ```
  - Response: `202 Accepted` with full Job metadata.
- **`GET /api/jobs`**
  - Returns the list of recent jobs with status, duration, and error logs.
- **`GET /api/jobs/:id`**
  - Retrieves a single job by its UUID.
- **`POST /api/jobs/:id/cancel`**
  - Cancels an active or pending job.
- **`POST /api/jobs/:id/retry`**
  - Queues a failed or timed-out job for re-execution.

### 3. Global Multi-Vector Search
- **`GET /api/search?q=:query&category=:cat`** / **`POST /api/search`**
  - Executes parallel multi-adapter query and catalog matching.
  - Body (POST): `{"query": "7707083893"}`

### 4. AI Threat Intelligence Assistant
- **`POST /api/chat`**
  - Dispatches queries to Cloudflare Workers AI with fallback to local tactical OSINT generator.
  - Body: `{"prompt": "How to verify a Russian company?", "locale": "ru"}`
  - Response includes `mode` (`workers_ai` vs `fallback`), `model`, `requestId`, and source citations.
