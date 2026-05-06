concise in speech, comprehensive in analysis.

1. Read Before Writing

- NEVER implement a solution without first reading all relevant existing code
- When building a new flow, find the existing flow that does something similar
  and follow its patterns exactly
- Don't reinvent the wheel - search for how the codebase already solves similar
  problems
- When you see an error or problem, read the related code thoroughly before
  proposing fixes

2. No Hacks in Production Code

- Never use type casts like as unknown as X to bypass type errors - they indicate
  you don't understand the data model
- Never create migrations or schema changes as a first resort - understand why
  the schema is designed that way
- If you're fighting the type system, you're probably doing something wrong
- Think through deployment order and race conditions before writing code

3. Keep UI Simple

- No emojis unless explicitly requested
- No flashy colors (especially green "success" colors) unless explicitly
  requested
- When in doubt, keep it simple - inline text over fancy badges, plain styles
  over decorated ones
- Don't over-design. If the user asks for X, give them X, not X with extra
  flourishes

4. Think Before Coding

- When asked to implement something significant, pause and plan first
- Ask yourself: "Is this production-ready? What could go wrong?"
- Consider: deployment order, race conditions, data integrity, existing patterns
- Don't be eager to write code - understanding the problem fully comes first

5. Treat Code Seriously

- This is production code that real users depend on
- Every change should be thoughtful, not reactive
- When you make a mistake, don't patch it with another hack - step back and do it
  right

6. Streaming First

- The SSE stream in app/api/job/route.ts is the core of the app. Every
  architectural decision should serve it.
- Results must be written to the stream as they finish scoring, not buffered and
  sent at the end. If you're collecting results into an array and sending them
  all at once, that's wrong.
- Always send a { type: 'done' } event to close the stream cleanly. Never let
  it hang.
- Handle client disconnect — if the SSE connection drops, abort the job
  server-side.

7. Two Concurrency Pools, Always Separate

- Scraping (ScraperAPI) and signal computation (image fetches, scoring) must use
  independent p-limit pools. Never share one pool between them.
- Scraping limit: 5. Signal computation limit: 8.
- If you find yourself using one limiter for everything, stop and fix it.

8. Request Budget Discipline

- ScraperAPI requests only: scraping queries count. Direct image fetches from
  CDN (e.g. m.media-amazon.com) do not count against the budget.
- Track a shared atomic counter in lib/jobs/requestBudget.ts. Check before every
  ScraperAPI call. Never inline the budget logic.
- Do not make requests you don't need. The goal is to not waste requests.

9. Deduplication is Eager

- Deduplicate by ASIN (Amazon) or itemId (eBay) before enqueuing scoring, not
  after. Never score a listing you'll throw away.
- The dedup Set lives in runSearchJob.ts and is checked synchronously before any
  scoring work begins.

10. Signals are Independent and Gracefully Degrade

- Each signal in lib/scoring/ must be self-contained. A failure in one signal
  must never crash or block the others.
- If imageHash fails (e.g. image fetch times out), return null for that signal
  and exclude it from the weighted average. Do not return 0 — that would
  unfairly penalize the listing.
- Never let a signal throw uncaught. Wrap every signal in try/catch and return
  null on failure.

11. Scoring Shape is Fixed

- Every scored listing must conform to this shape exactly. Do not deviate:

  {
    score: number,
    reasons: string[],
    signals: {
      titleSimilarity: number | null,
      brandInversion: number | null,
      imageHash: number | null,
      priceAnomaly: number | null,
    }
  }

- reasons must be human-readable strings, not internal keys. "Title closely
  matches Comfrt product names" not "titleSimilarity: 0.87".

12. Pre-filter Before Scoring

- Before running any signal, check if the listing title contains "comfrt"
  (case-insensitive). If it doesn't, skip scoring entirely and don't stream it.
- This is a cheap gate that saves image fetches and scoring work on irrelevant
  results. Do not skip it.

13. Types Live in types.ts

- All shared types (Listing, ScoredListing, SignalResult, SSEEvent, etc.) live
  in lib/types.ts. Nowhere else.
- Never inline types that are used in more than one file.
  If you find yourself copy-pasting a type, move it to types.ts.