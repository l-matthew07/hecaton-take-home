# Signal Design & Engineering Notes

This document covers the reasoning behind every major decision in the Comfrt infringement detection pipeline — what I tried, what I rejected, and why the final system is designed the way it is.

---

## The Core Problem

Comfrt is a direct-to-consumer loungewear brand. They don't sell through Amazon or eBay. So every listing on those platforms that uses the Comfrt brand name is either:

1. An unauthorized third-party reseller (someone buying and reselling genuine product — legally grey)
2. A fast-fashion brand doing keyword stuffing (using "comfrt" as a descriptor, not a brand reference)
3. A counterfeit operation (selling knockoffs under the Comfrt name)

The pipeline needs to distinguish between these categories and rank by infringement probability. Category 3 is what Bustem actually cares about — categories 1 and 2 are noise, but unavoidable noise.

---

## Query Strategy

### First iteration: hoodie-only
I started with 5 queries, all hoodie variations:
- "comfrt hoodie", "comfrt sweatshirt", "comfrt blanket hoodie", "comfrt oversized hoodie", "comfrt pullover"

This was wrong for two reasons. First, Comfrt's catalog is much broader than hoodies — they sell sweatpants, blankets, bags, pet products, athleisure (ComfrtCore™), kids clothing, and accessories like keychains and luggage. Second, my price anomaly signal was tuned entirely for hoodie pricing, so any non-hoodie listing would be scored incorrectly.

### Second iteration: full catalog coverage
I scraped comfrt.com's Shopify product catalog and built a comprehensive query list covering every product category. Key additions:

**Proprietary brand terms** (highest signal — only Comfrt uses these):
- "ComfrtCore leggings", "AllDayJersey hoodie", "CuddleCloud weighted blanket", "Dreamday plush robe"

These are invented product line names. Any listing using "ComfrtCore" or "AllDayJersey" is almost for sure infringing since legitimate resellers don't know these terms, and generic fast-fashion brands definitely don't use them.

**Category expansion:**
- Sweatpants, joggers, dreamer blanket, crew, affirmation hoodie, minimalist hoodie, signature hoodie, airplane mode hoodie, travel essentials, paw hoodie, anywhere bag, kids hoodie, robe

Final count: 20 queries × 2 pages × 2 platforms = 80 scrape tasks.

---

## The Pre-Filter

Every listing that passes scraping goes through a simple pre-filter: the title must contain "comfrt" (case-insensitive). This is the minimum bar for infringement since a listing can't infringe on the Comfrt brand if it doesn't reference the brand.

This filter typically reduces 500-800 scraped listings down to 50-150 scored listings per job.

---

## Signal Architecture

The spec required at least 4 independent signals. I implemented 8 across two tiers.

### The two-tier structure

The pipeline uses two weight tables depending on whether the ScraperAPI detail page fetch succeeded:

**Full path** (detail page returned 200):
- All 8 signals are attempted
- `titleSimilarity` and `brandPrefix` serve as low-weight floor signals (4% and 3% respectively)
- The 6 detail-page signals carry 93% of the weight when all fire

**Fallback path** (detail page failed — budget skip, 5xx, timeout):
- Drops the 4 detail-page-dependent signals entirely
- `titleSimilarity` (40%), `brandPrefix` (25%), `priceAnomaly` (25%), `imageSimilarity` (10%)

### Guaranteed minimum: ≥4 signals always score

`titleSimilarity`, `brandPrefix`, and `priceAnomaly` are always non-null — computed from search-result data alone, no detail page needed. `imageSimilarity` always participates in the weighted average via a neutral substitution: if the image is unavailable or the fetch times out, it scores as 0.5 (no visual evidence either way). The stored value in `signals.imageSimilarity` remains null so the UI correctly shows "n/a" rather than a misleading number.

This guarantees exactly 4 signals contribute to every score, with detail signals adding on top in the full path.

---

## Signal 1: Title Similarity (floor: 4% full / 40% fallback)

**What it measures:** Levenshtein distance between the listing title and the closest known Comfrt product name, normalized to 0–1.

**How it works:**
- Normalize title (lowercase, strip punctuation)
- If "comfrt" doesn't appear as a token, return 0 immediately
- Compute edit distance against all ~140 Comfrt product names from the Shopify catalog
- Score = 1 - (minDistance / longestLength)

A listing titled "Comfrt Minimalist Hoodie" scores close to 1.0. A listing titled "comfrt casual pullover" (keyword stuffing) scores lower because it doesn't match any actual product name.

**Why it's a floor signal in the full path:** When the detail page works, richer signals (seller identity, color authenticity, LLM) dominate. Title similarity and brand prefix carry only ~7% combined weight so they don't distort the score for legitimate resellers who happen to have well-matched titles. But they prevent degenerate 1-signal scoring when the detail page returns sparse data.

---

## Signal 2: Brand Prefix Score (floor: 3% full / 25% fallback)

**What it measures:** Whether the first 3 words of the title start with the Comfrt brand name, a known fast-fashion brand, or neither.

**Scoring:**
- Starts with "comfrt" → 0.8 (suspicious — brand impersonation pattern)
- Starts with a known fast-fashion brand → 0.2 (keyword stuffing, not counterfeit)
- Neither → 0.5 (neutral)

**Known fast-fashion keyword stuffers I identified:**
chicme, verdusa, gorglitter, yolai, ditok, tueteni, rmcms, caintima, automet, bofell

These brands use "comfrt" as a generic adjective ("comfrt casual pullover") rather than as a brand reference. They're not counterfeiting Comfrt; they're gaming search rankings.

**Normalization:** The raw value (-1/0/1) is stored for display. The 0.2/0.5/0.8 normalized form is what enters the weighted average.

---

## Signal 3: Price Anomaly (10% full / 25% fallback)

**What it measures:** Category-aware price deviation from Comfrt's retail range.

**Scoring curve (Amazon):**
| Category | High anomaly | Medium | Low |
|---|---|---|---|
| Hoodie / sweatshirt | <$40 → 0.9 | <$60 → 0.6 | <$80 → 0.3 |
| Blanket | <$60 → 0.9 | <$90 → 0.6 | <$120 → 0.3 |
| Bag | <$25 → 0.9 | <$40 → 0.6 | <$60 → 0.3 |
| Keychain / luggage tag | <$8 → 0.9 | <$15 → 0.6 | <$25 → 0.3 |
| Pet | <$15 → 0.9 | <$25 → 0.6 | <$40 → 0.3 |

eBay thresholds are shifted down $15 across all categories since eBay used/resale pricing runs lower.

Returns 0 if price is null (no anomaly — no evidence either way). Category is detected from keywords in the title.

---

## Signal 4: Seller Identity (27% full path only)

**What it measures:** Whether the seller is Comfrt itself, a known fast-fashion brand doing keyword stuffing, or an unidentified third party.

**How it works:**
- Fast-fashion brand check from title prefix (no detail page needed): returns 0.2
- Fetch the detail page (`sold_by` on Amazon; `seller.name` on eBay)
- Seller contains "comfrt" → 0.1 (very unlikely infringement — this is probably Comfrt)
- Seller matches known fast-fashion brands → 0.2 (keyword stuffing)
- Otherwise → 0.8 (unidentified seller, suspicious)

**Why 27% weight:** Seller identity is the strongest single predictor of infringement. An unidentified seller on eBay selling something branded "Comfrt Signature Hoodie" at below-retail price is exactly the counterfeit pattern.

**Null behavior:** Returns null when detail page is unavailable and the title prefix isn't a known fast-fashion brand. Excluded from weighted average via proportional rebalancing.

---

## Signal 5: Seller Reputation (13.5% full path only)

**What it measures:** How established the seller is, using review count as a proxy.

**Scoring curve:**
- <10 reviews → 0.9 (brand new seller, high risk)
- 10–50 reviews → 0.7
- 50–200 reviews → 0.4
- 200–1000 reviews → 0.2
- 1000+ reviews → 0.05 (established seller)

**The counterintuitive insight:** High review count is actually *less* suspicious. A seller with 50,000 reviews is almost certainly a legitimate resale operation. A brand new seller with 2 reviews selling "Comfrt Minimalist Hoodie" at $15 is the actual counterfeit pattern.

**Why only 13.5% weight:** Reputation alone is weak. Lots of legitimate eBay resellers have low review counts. It's a supporting signal, not a leading one.

---

## Signal 6: Color Authenticity (21.5% full path only)

**What it measures:** Whether the colors offered in the listing match Comfrt's actual named color palette.

**Why this works:** Comfrt uses distinctive invented color names — Bark, Lavender Cloud, Cherry Blossom, Bone, Sea Glass, Adirondack, Teddy, etc. These aren't generic colors. A legitimate Comfrt reseller listing an authentic product will have these exact color names. A counterfeit seller using generic "Dark Brown, Light Grey, Navy Blue" is a red flag.

**How it works:**
1. Extract color variants from the detail page (Amazon: `customization_options`; eBay: `variants` with `variant_type: "color"`)
2. For each extracted color, compute Levenshtein distance against all 150+ colors in the reference set
3. A color "matches" if min distance ≤ 2 (handles minor spelling variations)
4. Score = 1 - (matched colors / total colors)

So if a listing has 8 colors and 0 match Comfrt's palette → score 1.0 (maximum suspicion). If all 8 match → score 0.0 (consistent with authentic product).

**Reference set:** All 150+ color names pulled from Comfrt's Shopify product catalog.

**Null handling:** Returns null when no variant data is available (very common for eBay listings that don't expose color options in the structured data). Excluded from scoring when null, weight redistributed proportionally.

---

## Signal 7: LLM Judgment (22% full path only)

**What it measures:** A holistic assessment by Claude Sonnet of whether the listing is likely infringing, synthesizing all available context.

**Why I needed it:** The deterministic signals are good but miss things. The LLM can read the product description, understand the context of "Comfrt" appearing in a CHICME title vs. a standalone "COMFRT HOODIE" eBay listing, recognize suspicious authenticity claims ("100% Authentic✅"), and reason about combinations of signals that don't individually trigger thresholds.

**The pre-filter — the most important decision in the whole pipeline:** I don't call the LLM for every listing. Only if:
- `sellerIdentity >= 0.8` (unidentified seller) AND
- `priceAnomaly >= 0.3` OR `colorAuthenticity >= 0.5`

This reduces LLM calls from ~100 per job to ~10–20, which fits within Anthropic's free tier rate limit of 5 RPM over a 90-second window. Without this filter, I was hitting 429 errors on almost every call and most listings returned null for llmJudgment.

The pre-filter also makes architectural sense — I don't want to burn LLM calls on known fast-fashion keyword stuffers (sellerIdentity = 0.2) or listings where the price and color both look fine. The LLM should be reserved for genuinely ambiguous cases where deterministic signals are inconclusive.

**What the LLM receives:**
- Listing title, price, platform, seller name
- Detail page description snippet (first 300 chars)
- Pre-computed context values: titleSimilarity, brandPrefix, priceAnomaly
- Instruction to return JSON: `{ score: 0-1, reasons: string[] }`

**Prompt engineering:** I added an explicit instruction: "Only reference specific numbers such as review counts, prices, or ratings if they are explicitly present in the data provided. Do not invent or infer statistics." Without this, the LLM was hallucinating review counts from thin air. The reasons it generates after this fix are generally good — it correctly identifies things like "100% Authentic✅ in title is a common counterfeit tactic" and appropriately scores legitimate resales lower.

**Error handling:** Structured logging with listing ID, error type, status code, latency, and attempt number. Retries once on 429/ETIMEDOUT/ECONNRESET with 300–500ms jitter. Two attempts max, then null. LLM stats (attempts, successes, nulls, retries) are tracked per-job and reset at each job start so they don't accumulate across runs.

---

## Signal 8: Image Similarity (5% full / 10% fallback)

**What it measures:** Perceptual similarity between a listing's thumbnail and Comfrt's actual product images.

**Why I added it:** The spec explicitly mentioned image similarity. More importantly, it catches a real infringement pattern: sellers who steal product photos directly from comfrt.com.

**Why pHash and not embeddings:** Image embeddings (CLIP, etc.) would be more semantically meaningful but require an external API call per image. pHash (perceptual hash via 8x8 grayscale average) is deterministic, runs locally with `sharp`, and costs nothing per call.

**How it works:**
1. Fetch listing image as buffer
2. Resize to 8x8 grayscale pixels using `sharp`
3. Compute mean pixel value
4. For each pixel, set bit to 1 if above mean, 0 if below → 64-bit hash
5. Compare against pre-cached hashes of 65 authentic Comfrt product images using Hamming distance
6. Score = 1 - min(distances) / 64, where 0 = completely different, 1 = identical

**Hamming distance implementation:** Uses a two-pass 32-bit popcount (splitting the 64-bit XOR into two 32-bit halves) rather than a 64-iteration BigInt bit loop — approximately 10x faster, which matters when called against 65 reference hashes per listing.

**The neutral substitution:** When the image is unavailable (no `imageUrl`) or the fetch fails/times out (1500ms timeout), `imageSimilarity` is stored as null in `signals` for display (shows "n/a" in UI), but scored as 0.5 inside `computeFinalScore`. This neutral value means "no visual evidence either way" — it doesn't push the score up or down, ensuring the signal always participates in the weighted average without misrepresenting the data.

**The lifestyle photo problem:** Comfrt's product photos are lifestyle shots, models, specific lighting, studio backgrounds. Infringing listings have completely different photos. Even a genuine Comfrt resale on eBay would photograph the actual item they received, not Comfrt's studio photo. pHash won't catch most infringement types — but it *will* catch stolen product photos, which is the most clear-cut infringement case.

**The caching fix — a critical performance issue I caught:** Initially, `computeImageSimilarity` fetched all reference images every time it was called — once per listing. With 100 listings, that's 6,500+ Shopify CDN requests per job. I fixed this by precomputing reference hashes once at module load time using a cached Promise. The fetches happen once at startup and are reused across all listings.

---

## Scoring: Two Weight Tables with Null Handling

### Full path (detail page succeeded)
```
titleSimilarity:   4%   ← floor, always non-null
brandPrefix:       3%   ← floor, always non-null
priceAnomaly:     10%   ← always non-null
sellerIdentity:   27%   ← null if seller name missing from response
sellerReputation: 13.5% ← null if review count missing
colorAuthenticity: 21.5% ← null if no variant data
llmJudgment:      22%   ← null if gate condition not met or API fails
imageSimilarity:   5%   ← 0.5 neutral if unavailable (always scored)
```

### Fallback path (detail page failed)
```
titleSimilarity:  40%   ← always non-null
brandPrefix:      25%   ← always non-null
priceAnomaly:     25%   ← always non-null
imageSimilarity:  10%   ← 0.5 neutral if unavailable (always scored)
```

Null signals (sellerIdentity, sellerReputation, colorAuthenticity, llmJudgment in the full path) are excluded from the entries and the remaining weights are normalized proportionally so they still sum to 100%. This prevents null signals from deflating scores — a listing shouldn't score lower just because a marketplace doesn't expose color variant data.

**Guaranteed minimum signal count:** ≥4 signals always contribute to every score (titleSimilarity + brandPrefix + priceAnomaly + imageSimilarity via neutral substitution). Detail signals add on top.

---

## Fallback Reasons

When the LLM isn't called (pre-filter not met) or fails, I generate human-readable reasons from the deterministic signals:

- sellerIdentity 0.8 → "Seller is not a recognized Comfrt-affiliated account"
- sellerIdentity 0.2 → "Seller is a known fast-fashion brand using Comfrt brand name"
- priceAnomaly 0.9+ → "Price is significantly below Comfrt retail range"
- colorAuthenticity > 0.5 → "Color variants offered do not match Comfrt's known palette"
- brandPrefix 1 → "Title starts with Comfrt brand name"
- brandPrefix -1 → "Title starts with a known fast-fashion brand name"

These aren't as nuanced as LLM reasons but ensure every result has at least some explainability.

---

## What I'd Do Differently With More Time

**Image embeddings over pHash:** CLIP embeddings would let me ask "does this image look like a Comfrt product" semantically rather than pixel-by-pixel. A listing could have a completely different photo but similar visual style, and embeddings would catch it where pHash wouldn't.

**Reverse image search:** The most definitive signal for stolen photos. If a listing's image appears on comfrt.com, that's unambiguous infringement. Google Vision or TinEye would handle this.

**Seller history analysis:** How many other brand-infringing listings does this seller have? A seller with 50 listings all using different brand names as adjectives is a different risk profile than a one-off reseller.

**Geographic signals:** Most counterfeit operations ship from China. eBay listings with shipping location = China for branded goods are higher risk.

**LLM tier upgrade:** Upgrading to Anthropic Tier 2 ($5 spend) would give 1000 RPM and let me call the LLM on significantly more listings without rate limiting. The pre-filter was a workaround for the 5 RPM constraint, not an ideal design decision.

**Cross-listing deduplication by seller:** CHICME and GORGLITTER appear across dozens of listings for the same underlying product. I deduplicate by ASIN/item ID but not by seller+product combination. A smarter approach would collapse these into a single finding per offending seller.