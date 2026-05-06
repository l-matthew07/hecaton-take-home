

## File Structure

```
app/
  api/job/route.ts       ← SSE streaming endpoint
  page.tsx               ← frontend
lib/
  jobs/
    concurrency.ts       ← p-limit setup
    requestBudget.ts     ← shared request counter
    runSearchJob.ts      ← orchestrates the full pipeline
  marketplace/
    amazon.ts
    ebay.ts
  reference/
    comfrtProducts.ts    ← ~8 hardcoded image URLs from comfrt.com
  scoring/
    scoreListing.ts      ← stub for now, returns { score: 0, reasons: [], signals: {} }
  types.ts
```


## Core Data Flow

```
Search queries → scrape results → deduplicate → score each listing (4 signals in parallel) → stream scored results to frontend as they finish
```

Scrape and score should be **interleaved**, not sequential. Start scoring as soon as listings come in so results appear on screen early. Scrape-then-score is simpler but means nothing appears for the first minute or two.

---

## Scraping

**Endpoints:**
- Amazon: `https://api.scraperapi.com/structured/amazon/search/v1?api_key=...&query=...&tld=com`
- eBay: `https://api.scraperapi.com/structured/ebay/search/v1?api_key=...&query=...`

**Queries to run (both platforms):**
- "comfrt hoodie"
- "comfrt sweatshirt"
- "comfrt blanket hoodie"
- "comfrt oversized hoodie"
- "comfrt pullover"

**Pages:** 2 per query via `page` param

**Minimum scraping requests:** 5 queries × 2 pages × 2 platforms = **20 ScraperAPI requests**

---

## What the ScraperAPI Response Gives You

Structured search endpoint returns JSON with per-listing fields including title, price, thumbnail image URL, brand, and ASIN/itemId. The thumbnail is a **direct CDN link** (e.g. Amazon's `m.media-amazon.com`). You can fetch that image directly without going back through ScraperAPI. So image fetches don't count against the ScraperAPI budget.

You'd only need additional ScraperAPI requests if you wanted detail page data (fuller brand info, extra images, seller details). That's optional — structured search gives you enough for all four signals.

Optional second-pass strategy: listings that score above ~0.6 on text signals alone could get a detail page fetch for richer data.

---

## Request Budget

The doc says "soft budget" of ~120. **Soft means it's not a hard fail** — the real goal is demonstrating you're thinking about cost and efficiency, not gaming a number.

Better framing: don't make requests you don't need to.

**Practical breakdown:**
- ~20 ScraperAPI requests (scraping, fixed)
- ~0-10 ScraperAPI requests for selective detail page enrichment (optional)
- Image fetches: direct CDN, don't count against ScraperAPI budget but still need concurrency limiting

Realistically you might only need 20-30 ScraperAPI requests total. That's a *better* answer than engineering your way to exactly 119 — it shows you understood why the constraint exists.

**Show budget awareness in the UI** via the request counter broken down by platform. That's the real deliverable on this requirement.

---

## Concurrency

Two separate concerns, two separate limits:

- **Scraping concurrency** — hitting ScraperAPI. Limit: ~5 simultaneous
- **Signal computation concurrency** — fetching images, LLM calls. Limit: ~8 simultaneous

Keep them independent so they don't compete for the same pool. Use `p-limit` for both.

---

## Deduplication

Deduplicate **eagerly**, as results stream in — not after all scraping finishes. This way you avoid kicking off scoring work on a listing you'll throw away anyway.

Use a `Set` of ASINs (Amazon) / itemIds (eBay) checked before enqueuing scoring.

---

## Pre-filtering

Before doing expensive signal work (image fetches, LLM calls), apply a cheap title pre-filter: the listing title must contain "comfrt" (case-insensitive) to proceed to scoring. This cuts down the set significantly and saves budget.

---

## Scoring Signals

Four signals, weighted into a final 0-1 score. Chosen for independence (fail and succeed for different reasons), implementability in 2-3 hours, and graceful degradation.

| Signal | Description | Weight |
|---|---|---|
| **Title text similarity** | Fuzzy match listing title against known Comfrt product names. Fast, reliable, no external deps. | 35% |
| **Brand/seller inversion** | If brand says something other than "Comfrt" but the title contains "comfrt" → red flag. Smart because legit listings and brazen fakes both have "Comfrt" in the brand field. | 25% |
| **pHash image similarity** | Download listing thumbnail, compute perceptual hash distance against reference set images. Noisy, can fail if image doesn't load — skip gracefully if so. | 25% |
| **Price anomaly** | Comfrt hoodies retail ~$80-130. A listing for $18 is suspicious. Simple range check, no external calls, never fails. | 15% |

**Why price over LLM:** LLM calls cost a request per listing, add latency, and can fail. Price is instant, free, never errors, and actually very signal-rich since knockoffs are almost always underpriced.

**Explainability requirement:** for each listing you must return the final score, top contributing reasons in human-readable form, and raw signal values for debugging.

---

## Scoring Output Shape

```ts
{
  score: number,           // 0-1 final weighted score
  reasons: string[],       // e.g. ["Title closely matches Comfrt product names", "Price significantly below retail"]
  signals: {
    titleSimilarity: number,
    brandInversion: number,
    imageHash: number | null,  // null if image fetch failed
    priceAnomaly: number,
  }
}
```

---

## Job Lifecycle & Timeout

Set a hard timeout in the route handler (e.g. `setTimeout` at 4.5 minutes) that sends a `done` SSE event and closes the stream cleanly regardless of where the pipeline is. Don't let it hang.

Also handle client disconnect — if the SSE client drops, abort the job server-side rather than keep running.

---

## Frontend Requirements

- Button to trigger job
- Live-updating results list as they stream in
- Each result: title, platform, price, thumbnail, score
- Filter by platform (Amazon / eBay)
- Sort by score
- Expandable result showing signal details and reasons
- Total elapsed time + request count broken down by platform

UX matters here, visual design does not.

---

## SSE Streaming Pattern

```
Client hits GET /api/job
→ Server opens SSE stream
→ As each listing finishes scoring, server writes it to stream
→ Client appends to results list in real time
→ Server sends { type: 'done' } event when finished or timed out
→ Stream closes
```

---

## Reference Set

Hardcode ~8 Comfrt product image URLs from comfrt.com in `lib/reference/comfrtProducts.ts`. These are ground truth authentic products used for image similarity comparison.

---

## What's Deferred / Out of Scope

- Authentication
- Persistence / database
- Production scalability
- Signals folder (not scaffolded yet — signals TBD)
- ARCHITECTURE.md (separate deliverable, written last)