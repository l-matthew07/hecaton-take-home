# Comfrt Infringement Detection

A Next.js app that scans Amazon and eBay for potential Comfrt brand infringements. Triggers a search job, streams results progressively, and scores each listing using 5 independent signals weighted into a final infringement probability score.

---

## How It Works

1. **Click "Run scan"** — triggers a background job via Server-Sent Events
2. **Scraping** — runs 20 queries across both Amazon and eBay (2 pages each), deduplicating by ASIN/item ID
3. **Pre-filter** — only listings whose title contains "comfrt" are scored
4. **Scoring** — each listing is scored using 5 independent signals (details below)
5. **Streaming** — scored results arrive in the UI as they complete, sorted by infringement probability

---

## Scoring Signals

| Signal | Weight | Source |
|---|---|---|
| Seller identity | 27% | Who is selling — Comfrt, known fast-fashion brand, or unknown third party |
| LLM judgment | 27% | Claude Sonnet holistic assessment (title, price, description, context) |
| Color authenticity | 22.5% | Whether product color variants match Comfrt's actual 150+ color palette |
| Seller reputation | 13.5% | Review count as a proxy for seller establishment |
| Image similarity | 10% | Perceptual hash (aHash) comparison against 60 authentic Comfrt product images |

Signals that fail (detail page 404, image fetch timeout, etc.) degrade gracefully — the final score is computed from remaining non-null signals with proportional weight rebalancing. The LLM is only called when earlier signals suggest genuine ambiguity (unknown seller + price anomaly or color mismatch), keeping LLM usage to ~10–20 calls per job.

See [`signal_design.md`](./signal_design.md) for a full breakdown of every signal decision, what was rejected, and why.

---

## UI Features

- Results stream in as they're scored — no waiting for the full job to finish
- Filter by platform (Amazon / eBay / All)
- Sort by score (highest or lowest first)
- Expand any result to see signal breakdown, supporting data, and human-readable reasons
- Live stats: elapsed time, request count by platform

---

## Running Locally

**Prerequisites:** Node.js 18+, a [ScraperAPI](https://www.scraperapi.com/) key, and optionally an [Anthropic](https://www.anthropic.com/) API key (LLM signal disabled without it, other signals still work).

```bash
npm install
```

Create a `.env` file in the project root:

```env
SCRAPERAPI_KEY=your_scraperapi_key
ANTHROPIC_API_KEY=your_anthropic_api_key   # optional
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Run scan**.

---

## Project Structure

```
app/
  page.tsx          — frontend (single-page, streaming UI)
  api/job/route.ts  — SSE endpoint that runs the search job
lib/
  jobs/
    runSearchJob.ts   — orchestrator: scrape tasks, concurrency, timeout, streaming
    concurrency.ts    — p-limit instances (scrape: 5, signal: 8, LLM: 2)
    requestBudget.ts  — soft request budget (~160 requests)
  marketplace/
    amazon.ts         — ScraperAPI Amazon search scraper
    ebay.ts           — ScraperAPI eBay search scraper
  scoring/
    scoreListing.ts   — all 5 signals, weighted average, fallback reasons
    imageHash.ts      — perceptual hash implementation + reference image cache
  reference/
    comfrtProducts.ts — 140+ product names and 150+ color names from comfrt.com
  types.ts            — RawListing, ScoredListing, SSEEvent types
```

---

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how this pipeline would evolve into a multi-tenant system supporting hundreds of clients — covering job queues, per-client isolation, data storage, retry strategy, and observability.
