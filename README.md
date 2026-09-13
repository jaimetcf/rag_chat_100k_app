# RAG Chat (~100,000 DAU)

Same product surface as `hundreds_app`, tuned for roughly **100,000 daily active users**: serverless-safe Postgres pooling, distributed rate limits, tighter API limits, OpenAI retries with a circuit breaker, and multi-region Vercel config.

## Features

Everything in `hundreds_app`, plus:

- **PgBouncer / pooler-first** DB config (`PG_POOL_MAX=1` per serverless instance)
- **Upstash Redis** REST rate limiting across Vercel instances (optional; falls back to local)
- Stricter chat rate limit (20 / 10 min per user)
- Message history capped at 100 rows per thread fetch; 24 messages to OpenAI
- OpenAI retry + circuit breaker on upstream failures
- Extra DB indexes (`pg_migrations/003_scale_indexes.sql`)
- Multi-region deploy (`iad1`, `sfo1`, `cdg1`)
- k6 load test with higher VU ramp (`load-tests/api-load.ts`)

## Prerequisites

- Node.js 20+
- PostgreSQL with **connection pooler** (Neon pooler, Supabase pooler, or PgBouncer)
- OpenAI API key
- **Upstash Redis** (strongly recommended in production)
- Grafana k6
- Vercel Pro (recommended for 60s functions and multi-region)

## Install

```bash
cd rag_chat_100k
cp .env.example .env.local
# Set DATABASE_URL (pooler URL), OPENAI_API_KEY, AUTH_JWT_SECRET, Upstash vars
npm install
```

### Database migrations

```bash
psql "$DATABASE_URL" -f pg_migrations/001_chat_schema.sql
psql "$DATABASE_URL" -f pg_migrations/002_users_password_hash.sql
psql "$DATABASE_URL" -f pg_migrations/003_scale_indexes.sql
```

**Important:** `DATABASE_URL` must point at your **pooler** endpoint, not the direct primary if you run many Vercel lambdas.

## Run locally

```bash
npm run dev
```

For local dev without Upstash, rate limits use in-memory buckets (single process only).

```bash
npm run build && npm run start
```

## Deploy to Vercel

1. Create a Vercel project from `rag_chat_100k`.
2. Configure environment variables:
   - `DATABASE_URL` — pooler connection string
   - `OPENAI_API_KEY`
   - `AUTH_JWT_SECRET`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Enable regions matching `vercel.json` or adjust to your user base.
4. Use Vercel Postgres/Neon/Supabase with pooling enabled.

Verify deployment:

```bash
curl https://your-app.vercel.app/api/health
# Expect: {"ok":true,"tier":"rag_chat_100k","dauTarget":100000,"redisConfigured":true}
```

## Load testing (Grafana k6)

Run against a **staging/production** URL that mirrors your pooler + Redis setup. Do not run 400 VUs against localhost.

### Smoke

```bash
BASE_URL=https://your-scale-app.vercel.app npm run load-test:smoke
```

### High-concurrency profile

```bash
export BASE_URL=https://your-scale-app.vercel.app
export K6_VUS=400
npm run load-test
```

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | App origin |
| `K6_VUS` | `400` | Peak virtual users |
| `K6_CHAT_ENABLED` | `false` | `true` to load-test chat + OpenAI |

Start with read-only tests, then enable chat on a subset:

```bash
K6_VUS=50 K6_CHAT_ENABLED=true BASE_URL=https://your-scale-app.vercel.app k6 run load-tests/api-load.ts
```

### Interpreting results

- Expect some 429s under extreme load — distributed rate limits should cap OpenAI/DB cost.
- p95 latency under 12s for mixed read traffic.
- If `http_req_failed` rises, check pooler connection limits and Upstash quotas.

## Scaling checklist (100k DAU)

| Component | Recommendation |
|-----------|----------------|
| Postgres | Pooler URL, read replicas for analytics if needed |
| Vercel | Pro plan, multi-region, monitor function concurrency |
| Redis | Upstash for global rate limits |
| OpenAI | `gpt-5.4-nano` for titles; monitor org rate limits; circuit breaker protects cascades |
| Sessions API | Default `limit=30`, max 50 |
| Chat | 20 req / 10 min / user; 24-message context |

## Comparison with `hundreds_app`

| | Hundreds (~1k DAU) | RAG Chat (~100k DAU) |
|--|-------------------|------------------------------|
| DB pool max | 25 | 1 (via pooler) |
| Rate limit store | In-process | Upstash Redis (+ fallback) |
| Vercel regions | 1 | 3 |
| Context messages | 40 | 24 |
| Chat rate limit | 30 / 10 min | 20 / 10 min |
