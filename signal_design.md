# Signal Design & Engineering Notes

This document covers the reasoning behind every major decision in the Comfrt infringement detection pipeline — what we tried, what we rejected, and why the final system is designed the way it is.

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
We started with 5 queries, all hoodie variations:
- "comfrt hoodie", "comfrt sweatshirt", "comfrt blanket hoodie", "comfrt oversized hoodie", "comfrt pullover"

This was wrong for two reasons. First, Comfrt's catalog is much broader than hoodies — they sell sweatpants, blankets, bags, pet products, athleisure (ComfrtCore™), kids clothing, accessories like keychains and luggage. Second,ss our price anomaly signal was tuned entirely for hoodie pricing, so any non-hoodie listing would be scored incorrectly.

### Second iteration: full catalog coverage
We scraped comfrt.com's Shopify product catalog and built a comprehensive query list covering every product category. Key additions:

**Proprietary brand terms** (highest signal — only Comfrt uses these):
- "ComfrtCore leggings", "AllDayJersey hoodie", "CuddleCloud weighted blanket", "Dreamday plush robe"

These are invented product line names. Any listing using "ComfrtCore" or "AllDayJersey" is almost certainly infringing — legitimate sellers don't know these terms, and generic fast-fashion brands definitely don't use them.

**Category expansion**:
- Sweatpants, joggers, dreamer blanket, crew, affirmation hoodie, minimalist hoodie, signature hoodie, airplane mode hoodie, travel essentials, paw hoodie, anywhere bag, kids hoodie, robe

**Queries we cut:**
- "Comfrt hoodie replica", "Comfrt fake" etc. — infringers don't label themselves as fakes
- "Camo Hoodie Comfrt style" — the "style" suffix won't match real infringement listings  
- Taglines like "The Only Hoodie Worth Wearing" — marketing copy doesn't appear in marketplace titles
- Duplicate queries that were covered by other terms

Final count: 34 queries × 2 pages × 2 platforms = 136 scrape tasks, slightly over the 120 budget. Budget set to accommodate.

---

## The Pre-Filter

Every listing that passes scraping goes through a simple pre-filter: the title must contain "comfrt" (case-insensitive). This is the minimum bar for infringement — a listing can't infringe on the Comfrt brand if it doesn't reference the brand.

This filter typically reduces 500-800 scraped listings down to 50-150 scored listings per job.

---

## Signal Architecture: Why These Four

The spec required at least 4 independent signals. We chose signals that each capture a fundamentally different dimension of suspicion:

1. **Seller identity** — *who is selling this?*
2. **Seller reputation** — *how established is this seller?*
3. **Color authenticity** — *do the product variants match Comfrt's actual palette?*
4. **LLM judgment** — *holistic assessment combining title, description, price, and context*
5. **Image similarity** — *does this listing's image look like a Comfrt product?* (5th signal added)

These are genuinely independent — a listing can have a suspicious seller identity but a legitimate price (reseller), or a great price match but stolen photos (counterfeit). The signals don't just measure the same thing from different angles.

---

## Signal 1: Seller Identity (27%)

**What it measures:** Whether the seller is Comfrt itself, a known fast-fashion brand doing keyword stuffing, or an unidentified third party.

**How it works:**
- Fetch the detail page (Amazon: `sold_by` field; eBay: `seller.name`)
- If seller name contains "comfrt" → score 0.1 (very unlikely infringement — this is probably Comfrt)
- If seller name matches known fast-fashion brands → score 0.2 (keyword stuffing, not counterfeit)
- Otherwise → score 0.8 (unidentified seller, suspicious)

**Known fast-fashion brands in the list:**
chicme, verdusa, gorglitter, yolai, ditok, tueteni, rmcms, caintima, automet, bofell

These brands are observed keyword-stuffers — they put "comfrt" in their title as a generic adjective ("comfrt casual pullover") rather than as a brand reference. They're not counterfeiting Comfrt; they're gaming search rankings. Still a signal worth capturing because it lets us score them lower than a truly unknown seller.

**Why 27% weight:** Seller identity is the strongest single predictor of infringement. An unidentified seller on eBay selling something branded "Comfrt Signature Hoodie" at below-retail price is exactly the counterfeit pattern. It's the highest-weight individual signal.

**Weakness:** Fails gracefully when the detail page fetch fails — returns null, and the signal is excluded from weighted average with proportional rebalancing.

---

## Signal 2: Seller Reputation (13.5%)

**What it measures:** How established the seller is, using review count as a proxy.

**Scoring curve:**
- <10 reviews → 0.9 (brand new seller, high risk)
- 10-50 reviews → 0.7
- 50-200 reviews → 0.4
- 200-1000 reviews → 0.2
- 1000+ reviews → 0.05 (established seller)

**The counterintuitive insight:** High review count is actually *less* suspicious for our purposes. A seller with 50,000 reviews is almost certainly a legitimate resale operation — they're not running a counterfeit scheme, they're just reselling used or new authentic items. A brand new seller with 2 reviews selling "Comfrt Minimalist Hoodie" at $15 is the actual counterfeit pattern.

**Why only 13.5% weight:** Reputation alone is weak. Lots of legitimate eBay resellers have low review counts. And some counterfeit operations get very established. It's a supporting signal, not a leading one.

---

## Signal 3: Color Authenticity (22.5%)

**What it measures:** Whether the colors offered in the listing match Comfrt's actual named color palette.

**Why this works:** Comfrt uses distinctive invented color names — Bark, Lavender Cloud, Cherry Blossom, Bone, Sea Glass, Adirondack, Teddy, etc. These aren't generic colors. A legitimate Comfrt reseller listing an authentic product will have these exact color names. A counterfeit seller using generic "Dark Brown, Light Grey, Navy Blue" is a red flag.

**How it works:**
1. Extract color variants from the detail page (Amazon: `customization_options`; eBay: `variants` with `variant_type: "color"`)
2. For each extracted color, compute Levenshtein distance against all 150+ colors in our reference set
3. A color "matches" if min distance ≤ 2 (handles minor spelling variations)
4. Score = 1 - (matched colors / total colors)

So if a listing has 8 colors and 0 match Comfrt's palette → score 1.0 (maximum suspicion). If all 8 match → score 0.0 (consistent with authentic product).

**The reference set:** We pulled all 150+ color names from Comfrt's Shopify product catalog — the same API that powers their store. This is the ground truth.

**Null handling:** Returns null when no variant data is available (very common for eBay listings that don't expose color options in the structured data). The signal is excluded from scoring when null.

**Why 22.5% weight:** Strong signal when available, but frequently null. Lower weight than seller identity to account for its sparseness.

---

## Signal 4: LLM Judgment (27%)

**What it measures:** A holistic assessment by Claude Sonnet of whether the listing is likely infringing, synthesizing all available context.

**Why we need it:** The deterministic signals (seller identity, reputation, color) are good but miss things. The LLM can read the product description, understand the context of "Comfrt" appearing in a CHICME title vs. a standalone "COMFRT HOODIE" eBay listing, recognize suspicious authenticity claims ("100% Authentic✅"), and reason about combinations of signals that don't individually trigger thresholds.

**The pre-filter (critical):** We don't call the LLM for every listing. Only if:
- `sellerIdentity >= 0.8` (unidentified seller) AND
- `priceAnomaly >= 0.3` OR `colorAuthenticity >= 0.5`

This reduces LLM calls from ~100 per job to ~10-20, which fits within Anthropic's free tier rate limit of 5 RPM over a 90-second window. Without this filter, we hit 429 errors constantly and most listings returned null for llmJudgment.

**The rate limit problem:** Our Anthropic account was on Tier 1 (5 RPM). Even with llmLimit at concurrency 2, we were firing ~50 LLM calls simultaneously and burning through the budget in the first minute. The pre-filter was the real fix — not concurrency tuning.

**What the LLM receives:**
- Listing title, price, platform, seller name
- Detail page description snippet (first 300 chars)
- Pre-computed context values: titleSimilarity, brandPrefix, priceAnomaly
- Instruction to return JSON: `{ score: 0-1, reasons: string[] }`

**Prompt engineering notes:**
- Explicit instruction: "Only reference specific numbers such as review counts, prices, or ratings if they are explicitly present in the data provided. Do not invent or infer statistics."
- Without this, the LLM hallucinated review counts ("high review count of 12,829") that weren't in the data
- The reasons it generates are generally good quality — it correctly identifies things like "100% Authentic✅ in title is common counterfeit tactic" and appropriately scores legitimate resales lower

**Why 27% weight:** Same as seller identity — it's the most context-aware signal and should have significant influence. But it's also the most expensive and sometimes null, so capped at 27%.

---

## Signal 5: Image Similarity (10%)

**What it measures:** Perceptual similarity between a listing's thumbnail and Comfrt's actual product images.

**Why we added it:** The spec explicitly mentioned image similarity as an expected signal. More importantly, it catches a real infringement pattern: sellers who steal product photos directly from comfrt.com.

**Why pHash and not embeddings:** Image embeddings (CLIP, etc.) would be more semantically meaningful but require an external API call per image. pHash (perceptual hash via 8x8 grayscale average) is deterministic, runs locally with `sharp`, and costs nothing per call.

**How it works:**
1. Fetch listing image as buffer
2. Resize to 8x8 grayscale pixels using `sharp`
3. Compute mean pixel value
4. For each pixel, set bit to 1 if above mean, 0 if below → 64-bit hash
5. Compare against pre-cached hashes of 60 authentic Comfrt product images using Hamming distance
6. Score = min(distances) / 64, where 0 = identical, 1 = completely different

**The lifestyle photo problem:** We debated whether this signal is useful at all. Comfrt's product photos are lifestyle shots — models, specific lighting, studio backgrounds. Infringing listings have completely different photos (different models, flat lays, stolen from other sources). Even a genuine Comfrt resale on eBay would photograph the actual item they received, not Comfrt's studio photo.

This means pHash won't catch most infringement types. But it *will* catch the specific pattern of stolen product photos — the most clear-cut infringement case. And at 10% weight, a null or misleading signal doesn't distort the overall score much.

**The caching fix:** Initially, `computeImageSimilarity` fetched all 60 reference images every time it was called — once per listing. With 100 listings, that's 6,000 Shopify CDN requests per job. We fixed this by precomputing reference hashes once at module load time using a cached Promise, so the 60 fetches happen once at startup and are reused for every listing.

**Reference set:** 60 images spanning all product categories — hoodies, zip hoodies, sweatpants, blankets, crew sweatshirts, the Anywhere Bag, kids hoodie, pet hoodie, and various colorways. Wider coverage means more surface area for catching stolen photos across categories.

**Why only 10% weight:** Noisy signal for the reasons above. Lifestyle photo mismatch is expected even for legitimate listings.

---

## Context Values (Metadata, Not Signals)

Three values are computed for every listing but don't participate in the weighted average — they're passed to the LLM for context and displayed in the UI for transparency:

**Title Similarity (0-1):** Levenshtein distance between the listing title and the closest Comfrt product name in our reference catalog. Requires "comfrt" to appear as a standalone token — a title that just uses "comfrt" as an adjective ("comfrt casual pullover") won't match well against "Minimalist Hoodie".

**Brand Prefix (-1/0/1):** Whether the first 3 words of the title start with "comfrt" (+1), a known fast-fashion brand (-1), or neither (0). Quick heuristic for keyword stuffing vs. brand impersonation.

**Price Anomaly (0/0.3/0.6/0.9):** Category-aware price deviation. Hoodie thresholds: <$40 Amazon = anomaly 0.9. Blanket thresholds: <$60. Bag thresholds: <$25. eBay thresholds shift down $15 across all categories. Returns 0 if price is null.

These were originally considered as full signals, but they work better as LLM context — the LLM synthesizes them into its judgment rather than them independently contributing to the score.

---

## Scoring: Weighted Average with Null Handling

Final score = weighted average of non-null signals, with proportional reweighting when signals are null.

Base weights: sellerIdentity=27%, sellerReputation=13.5%, colorAuthenticity=22.5%, llmJudgment=27%, imageSimilarity=10%.

If colorAuthenticity is null (very common — many listings have no variant data), the other four signals are reweighted proportionally so they still sum to 100%. This prevents null signals from deflating scores — a listing shouldn't score lower just because a marketplace doesn't expose color data.

The catch-all fallback: if all signals are null (detail page failed completely), the listing scores 0. This is intentional — we'd rather not surface completely unscored listings than surface garbage scores.

---

## Fallback Reasons

When the LLM isn't called (pre-filter not met) or fails, we generate human-readable reasons from the deterministic signals:

- sellerIdentity 0.8 → "Seller is not a recognized Comfrt-affiliated account"
- sellerIdentity 0.2 → "Seller is a known fast-fashion brand using Comfrt brand name"  
- priceAnomaly 0.9+ → "Price is significantly below Comfrt retail range"
- colorAuthenticity > 0.5 → "Color variants offered do not match Comfrt's known palette"
- brandPrefix 1 → "Title starts with Comfrt brand name"
- brandPrefix -1 → "Title starts with a known fast-fashion brand name"
- etc.

These aren't as nuanced as LLM reasons but ensure every result has at least some explainability, satisfying the spec requirement.

---

## What We'd Do Differently With More Time

**Image embeddings over pHash:** CLIP embeddings would let us ask "does this image look like a Comfrt product" semantically rather than pixel-by-pixel. A listing could have a completely different photo but similar visual style, and embeddings would catch it where pHash wouldn't.

**Reverse image search:** The most definitive signal for stolen photos. If a listing's image appears on comfrt.com, that's unambiguous infringement. Google Vision or TinEye would handle this.

**Seller history analysis:** How many other brand-infringing listings does this seller have? A seller with 50 listings all using different brand names as adjectives is a different risk profile than a one-off reseller.

**Geographic signals:** Most counterfeit operations ship from China. eBay listings with shipping location = China for branded goods are higher risk.

**LLM tier upgrade:** Upgrading the Anthropic API key to Tier 2+ ($5 spend) would give 1000 RPM and let us call the LLM on significantly more listings without rate limiting. The pre-filter was a workaround for the 5 RPM constraint.

**Cross-listing deduplication:** CHICME and GORGLITTER appear across dozens of listings for the same underlying product. We deduplicate by ASIN/item ID but not by seller+product combination. A smarter dedup would collapse these into a single finding per offending seller.