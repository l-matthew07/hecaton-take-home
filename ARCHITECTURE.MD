# ARCHITECTURE.md — Multi-Tenant Evolution

## Overview

The current system runs a single synchronous job per request: scrape → score → stream. Evolving this to support hundreds of clients requires decoupling job execution from HTTP connections, isolating resources per client, and building observability into the pipeline from the start.

---

## Job Orchestration

Replace the in-process SSE handler with a persistent job queue (e.g. BullMQ backed by Redis, or a managed service like AWS SQS). When a client triggers a scan, the API enqueues a job and returns a job ID. A pool of worker processes picks jobs off the queue and executes the pipeline independently of any HTTP connection.

Workers are stateless and horizontally scalable. Each worker handles one job at a time, respecting concurrency limits at the worker level rather than the process level.

**Streaming results back to the client:** Rather than long-polling (which introduces result latency and thundering-herd risk at scale), workers publish scored results to a per-job Redis pub/sub channel as they complete. The frontend maintains a persistent SSE connection to an API endpoint that subscribes to that channel and forwards events — preserving the progressive streaming UX without coupling the HTTP connection lifetime to the worker.

For the 3–5 minute runtime, jobs need heartbeating so the queue knows they're alive. Stalled jobs (no heartbeat for >2 minutes) get re-queued automatically. Re-queued jobs are **idempotent**: results are keyed by `(job_id, listing_id)` in the results store, so a restarted job that re-scores a listing it already processed overwrites the same row rather than creating a duplicate.

**Per-client queue isolation:** Jobs from all clients share a worker pool, but each client is assigned a weighted priority slot to prevent one client submitting 50 jobs from starving other clients' queues. BullMQ's priority queue or a per-client sub-queue with round-robin dispatch both work here.

---

## Rate Limiting & Per-Client Isolation

Each client gets its own ScraperAPI key (or a key pool), its own Anthropic API key, and its own request budget counter in Redis. This prevents one client's burst from affecting another's throughput.

LLM calls are the most constrained resource. A global token bucket per Anthropic key enforces the RPM limit across all workers sharing that key. Clients on different tiers get different LLM concurrency allocations — a higher-tier client might get 10 RPM, a free-tier client gets 2.

Scraping concurrency is enforced per-job, not globally, since ScraperAPI keys are per-client.

At the storage layer, Postgres row-level security (RLS) ensures one client can never query another client's jobs or results — tenant isolation is enforced at the database level, not just the application layer.

---

## Data Storage

| Data | Store | Retention |
|------|-------|-----------|
| Client / tenant config (API keys, tier, concurrency limits) | Postgres | Indefinite |
| Job state (queued/running/done/failed) | Redis | 7 days |
| Scored results | Postgres (jsonb, keyed by job_id + listing_id) | 90 days |
| Raw scrape artifacts | S3 | 30 days |
| LLM prompts/responses | S3 (for audit) | 90 days |
| Reference image hashes | Redis (precomputed at deploy time by a startup job) | Indefinite |

Jobs are queryable by client ID, status, and timestamp. Results are stored with full signal breakdowns so past runs can be re-scored without re-scraping if the scoring logic changes.

Reference image hashes are computed once at deploy time by a startup job and written to Redis. Workers read from cache on every request — no per-worker cold-start cost.

---

## Retry Strategy & Failure Handling

Each signal is independently retried with exponential backoff. Signals that fail after 2 attempts degrade gracefully — the final score is computed from remaining non-null signals with proportional reweighting. A job never fails because one signal failed.

ScraperAPI failures (5xx, timeout) retry up to 3 times with jitter. If a listing's detail page fails, it scores on search-result data only. If more than 50% of scrape tasks fail, the job is marked degraded and the client is notified via the result stream.

LLM 429s are retried once after a 60-second backoff. Subsequent 429s within the same job are not retried — the job completes without LLM signals for those listings rather than blocking.

---

## Observability

Metrics to track (emitted per job, per worker, and per signal):

- **Job throughput**: jobs enqueued / completed / failed / degraded per hour, per client
- **Signal success rates**: what % of listings get each signal, broken down by platform
- **LLM metrics**: RPM consumed, 429 rate, retry rate, avg latency, null rate
- **ScraperAPI metrics**: requests made, budget hit rate, 4xx/5xx rate per query
- **Scoring distribution**: histogram of final scores across jobs — drift here signals scraper or signal quality changes
- **End-to-end latency**: time from job enqueue to first result, to last result

Structured logs (JSON) for every signal failure, budget skip, and LLM error. Dashboarded in Grafana or similar.

**Alerting thresholds:** Alert when signal null rate exceeds 40% over a 5-minute window (likely scraper blocked), LLM 429 rate exceeds 20% (budget exhausted), or job failure rate exceeds 5% over 10 minutes (worker or queue issue). These thresholds make it immediately obvious when a client is getting degraded results before they notice it themselves.