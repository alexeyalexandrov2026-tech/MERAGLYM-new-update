# MERAGLYM System Architecture

```
                    INTERNET / ANALYST
                            │
                            ▼
                     Cloudflare Edge
                            │
              ┌─────────────┴─────────────┐
              │                           │
        Frontend (Next.js)           API Functions
       (Bilingual UI/UX)         (/api/health, /api/jobs,
              │                  /api/search, /api/chat)
              │                           │
              │                 ┌─────────┴─────────┐
              │                 │                   │
              │            D1 Database         Queue / Jobs
              │                 │                   │
              │                 │            Adapter Engine
              │                 │           (21 OSINT Adapters)
              │                 │                   │
              └─────────────────┴───────────────────┘
                                  │
                           Observations &
                          Source Provenance
                                  │
                          Entity Resolution
                                  │
                            STIX 2.1 Graph
```

## Key Subsystems

1. **Edge Frontend & Navigation**:
   - Built on Next.js 16 (App Router) + React 19 + TypeScript.
   - Client-side state synchronization with full Russian/English localization.
2. **Serverless Functions Layer (`functions/api/`)**:
   - Handles API routing, SSRF sanitization, rate limiting, and request ID generation.
3. **Database Layer (Cloudflare D1 & Prisma)**:
   - Persistent storage for `Node`, `Job`, `Entity`, `Relationship`, and `Observation`.
4. **Adapter Intelligence Layer (`src/lib/adapters/`)**:
   - 21 modular adapters supporting CIS state registries, global reconnaissance, cryptocurrency tracing, CCTV/IoT streams, and STIX 2.1 graph generation.
5. **Security & OPSEC Safeguards**:
   - SSRF protection rejecting loopback/private/metadata ranges.
   - PII/secret scrubbing in structured logs.
