import 'dotenv/config'
import { distance } from 'fastest-levenshtein'
import { llmLimit } from '../jobs/concurrency'
import { increment, isOverBudget } from '../jobs/requestBudget'
import { COMFRT_COLORS, COMFRT_PRODUCTS } from '../reference/comfrtProducts'
import { RawListing, ScoredListing } from '../types'
import { computeImageSimilarity } from './imageHash'

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const FAST_FASHION_BRANDS = [
    'chicme',
    'verdusa',
    'generic',
    'gorglitter',
    'yolai',
    'ditok',
    'tueteni',
    'rmcms',
    'caintima',
    'automet',
    'bofell',
]

/**
 * Used when the detail page fetched successfully.
 * titleSimilarity/brandPrefix are included at low weight as a guaranteed floor —
 * they contribute ~3-4% each when all detail signals fire, but prevent degenerate
 * 1-signal scoring when the detail page returns sparse data (no seller name, no colors, etc.)
 */
const FULL_WEIGHTS = {
    titleSimilarity: 0.04,
    brandPrefix: 0.03,
    priceAnomaly: 0.10,
    sellerIdentity: 0.27,
    sellerReputation: 0.135,
    colorAuthenticity: 0.215,
    llmJudgment: 0.27,
    imageSimilarity: 0.10,
} as const

/**
 * Used when the detail page fetch failed (budget skip, 5xx, timeout, etc.)
 * Falls back to text-only signals derived from the search result alone.
 * titleSimilarity/brandPrefix/priceAnomaly are always non-null, guaranteeing ≥3 signals.
 * imageSimilarity adds a 4th when an image URL is available.
 */
const FALLBACK_WEIGHTS = {
    titleSimilarity: 0.40,
    brandPrefix: 0.25,
    priceAnomaly: 0.25,
    imageSimilarity: 0.10,
} as const

type WeightMap = typeof FULL_WEIGHTS | typeof FALLBACK_WEIGHTS

const IMAGE_SIMILARITY_TIMEOUT_MS = 1500

const llmStats = {
    totalAttempts: 0,
    successCount: 0,
    nullCount: 0,
    retryCount: 0,
}

export function getLlmStats(): typeof llmStats {
    return llmStats
}

type DetailData = Record<string, unknown>

type LlmResult = {
    score: number
    reasons: string[]
}

type ScoringContext = {
    titleSimilarity: number
    brandPrefix: -1 | 0 | 1
    priceAnomaly: number
}

export async function scoreListing(listing: RawListing): Promise<ScoredListing> {
    const context = computeScoringContext(listing)

    try {
        const detailData = await fetchDetailPage(listing)

        const [sellerIdentity, sellerReputation, colorAuthenticity, imageSimilarity] = await Promise.all([
            computeSignal(() => computeSellerIdentity(listing, listing.title, detailData)),
            computeSignal(() => computeSellerReputation(listing, detailData)),
            computeSignal(() => computeColorAuthenticity(listing, detailData)),
            computeSignal(() => listing.imageUrl ? withTimeout(computeImageSimilarity(listing.imageUrl), IMAGE_SIMILARITY_TIMEOUT_MS, null) : null),
        ])
        const shouldCallLlm =
            sellerIdentity !== null &&
            sellerIdentity >= 0.8 &&
            (context.priceAnomaly >= 0.3 || (colorAuthenticity !== null && colorAuthenticity >= 0.5))
        const llmResult = shouldCallLlm
            ? await computeSignal(() => llmLimit(() => computeLlmJudgment(listing, listing.id, detailData, context)))
            : null
        const llmJudgment = llmResult?.score ?? null

        // Choose weight table based on whether the detail page actually returned data
        const hasDetailData = detailData !== null
        const score = computeFinalScore({
            titleSimilarity: context.titleSimilarity,
            brandPrefix: brandPrefixToScore(context.brandPrefix),
            sellerIdentity,
            sellerReputation,
            colorAuthenticity,
            priceAnomaly: context.priceAnomaly,
            llmJudgment,
            imageSimilarity,
        }, hasDetailData)
        const reasons = llmResult?.reasons.length
            ? llmResult.reasons
            : buildFallbackReasons({
                sellerIdentity,
                sellerReputation,
                colorAuthenticity,
                priceAnomaly: context.priceAnomaly,
                brandPrefix: context.brandPrefix,
            })

        return {
            ...listing,
            score,
            reasons,
            llmReasons: llmResult?.reasons ?? [],
            titleSimilarity: context.titleSimilarity,
            brandPrefix: context.brandPrefix,
            priceAnomaly: context.priceAnomaly,
            signals: {
                titleSimilarity: context.titleSimilarity,
                brandPrefix: brandPrefixToScore(context.brandPrefix),
                sellerIdentity,
                sellerReputation,
                colorAuthenticity,
                priceAnomaly: context.priceAnomaly,
                llmJudgment,
                imageSimilarity,
            },
        }
    } catch {
        // Something unexpected failed (e.g. unhandled fetchDetailPage throw).
        // Return a small non-zero score with an explicit error reason so this
        // listing doesn't rank as "known safe" in the results view.
        return {
            ...listing,
            score: 0.05,
            reasons: ['Scoring error — signals could not be computed'],
            llmReasons: [],
            titleSimilarity: context.titleSimilarity,
            brandPrefix: context.brandPrefix,
            priceAnomaly: context.priceAnomaly,
            signals: {
                titleSimilarity: context.titleSimilarity,
                brandPrefix: brandPrefixToScore(context.brandPrefix),
                sellerIdentity: null,
                sellerReputation: null,
                colorAuthenticity: null,
                priceAnomaly: context.priceAnomaly,
                llmJudgment: null,
                imageSimilarity: null,
            },
        }
    }
}

async function computeSignal<T>(fn: () => T | Promise<T>): Promise<T | null> {
    try {
        return await fn()
    } catch {
        return null
    }
}

/**
 * Normalizes brandPrefix (-1 | 0 | 1) to a 0–1 score for use in weighted averaging.
 *   1  → 0.8  (title starts with "comfrt" — suspicious)
 *   0  → 0.5  (neutral — no strong brand signal)
 *  -1  → 0.2  (known fast-fashion brand clearly labeled — less suspicious)
 */
function brandPrefixToScore(prefix: -1 | 0 | 1): number {
    if (prefix === 1) return 0.8
    if (prefix === -1) return 0.2
    return 0.5
}

async function fetchDetailPage(listing: RawListing): Promise<DetailData | null> {
    try {
        const endpoint = buildDetailEndpoint(listing)
        if (!endpoint) return null

        if (isOverBudget()) {
            console.warn({ event: 'scraperapi_budget_skip', requestType: 'detail_page', listingId: listing.id, platform: listing.platform })
            return null
        }

        increment()
        const res = await fetch(endpoint)
        if (!res.ok) return null

        const data: unknown = await res.json()
        return isRecord(data) ? data : null
    } catch {
        return null
    }
}

function buildDetailEndpoint(listing: RawListing): string | null {
    if (!SCRAPERAPI_KEY || !listing.id) return null

    const apiKey = encodeURIComponent(SCRAPERAPI_KEY)
    const id = encodeURIComponent(listing.id)

    if (listing.platform === 'amazon') {
        return `https://api.scraperapi.com/structured/amazon/product/v1?api_key=${apiKey}&asin=${id}`
    }

    return `https://api.scraperapi.com/structured/ebay/product?api_key=${apiKey}&product_id=${id}&tld=com`
}

function computeScoringContext(listing: RawListing): ScoringContext {
    return {
        titleSimilarity: computeTitleSimilarity(listing.title),
        brandPrefix: computeBrandPrefix(listing.title),
        priceAnomaly: computePriceAnomaly(listing.platform, listing.price, listing.title),
    }
}

function computeTitleSimilarity(title: string): number {
    const normalizedTitle = normalizeText(title)
    const tokens = normalizedTitle.split(/\s+/).filter(Boolean)
    if (!tokens.includes('comfrt')) return 0

    let minDistance = Number.POSITIVE_INFINITY
    let longestLength = normalizedTitle.length

    for (const product of COMFRT_PRODUCTS) {
        const normalizedProduct = normalizeText(product)
        const currentDistance = distance(normalizedTitle, normalizedProduct)
        if (currentDistance < minDistance) {
            minDistance = currentDistance
            longestLength = Math.max(normalizedTitle.length, normalizedProduct.length)
        }
    }

    if (!Number.isFinite(minDistance) || longestLength === 0) return 0
    return clamp01(1 - minDistance / longestLength)
}

function computeBrandPrefix(title: string): -1 | 0 | 1 {
    const prefix = normalizeText(title).split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
    if (prefix.startsWith('comfrt')) return 1
    if (FAST_FASHION_BRANDS.some((brand) => prefix.startsWith(brand))) return -1
    return 0
}

function computePriceAnomaly(platform: RawListing['platform'], price: number | null, title: string): number {
    if (price === null) return 0

    const normalizedTitle = normalizeText(title)
    const thresholds = normalizedTitle.includes('blanket')
        ? [60, 90, 120]
        : normalizedTitle.includes('jogger') || normalizedTitle.includes('sweatpant')
            ? [40, 60, 80]
            : normalizedTitle.includes('bag')
                ? [25, 40, 60]
                : normalizedTitle.includes('keychain') || normalizedTitle.includes('luggage') || normalizedTitle.includes('tag')
                    ? [8, 15, 25]
                    : normalizedTitle.includes('pet')
                        ? [15, 25, 40]
                        : [40, 60, 80]
    const [highThreshold, mediumThreshold, lowThreshold] = platform === 'ebay'
        ? thresholds.map((threshold) => threshold - 15)
        : thresholds

    if (price < highThreshold) return 0.9
    if (price < mediumThreshold) return 0.6
    if (price < lowThreshold) return 0.3
    return 0
}

function computeSellerIdentity(listing: RawListing, title: string, detailData: DetailData | null): number | null {
    const prefix = title.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
    if (FAST_FASHION_BRANDS.some((brand) => prefix.startsWith(brand))) return 0.2

    if (!detailData) return null

    const sellerName = getSellerName(listing, detailData)
    if (!sellerName) return null

    const normalizedSeller = sellerName.toLowerCase()
    if (normalizedSeller.includes('comfrt')) return 0.1
    if (FAST_FASHION_BRANDS.some((brand) => normalizedSeller.includes(brand))) return 0.2
    return 0.8
}

function computeSellerReputation(listing: RawListing, detailData: DetailData | null): number | null {
    if (!detailData) return null

    const reviewCount =
        listing.platform === 'amazon'
            ? toNumber(detailData.total_reviews)
            : toNumber(getNested(detailData, ['seller', 'seller_reviews_count']))

    if (reviewCount === null) return null
    if (reviewCount < 10) return 0.9
    if (reviewCount <= 50) return 0.7
    if (reviewCount <= 200) return 0.4
    if (reviewCount <= 1000) return 0.2
    return 0.05
}

function computeColorAuthenticity(listing: RawListing, detailData: DetailData | null): number | null {
    if (!detailData) return null

    const colors = listing.platform === 'amazon' ? extractAmazonColors(detailData) : extractEbayColors(detailData)
    if (colors.length === 0) return null

    const knownColors = COMFRT_COLORS.map(normalizeColor).filter(Boolean)
    const matchingColors = colors.filter((color) => {
        const normalizedColor = normalizeColor(color)
        return knownColors.some((knownColor) => distance(normalizedColor, knownColor) <= 2)
    }).length

    return clamp01(1 - matchingColors / colors.length)
}

async function computeLlmJudgment(
    listing: RawListing,
    listingId: string,
    detailData: DetailData | null,
    context: ScoringContext,
): Promise<LlmResult | null> {
    if (!ANTHROPIC_API_KEY) {
        llmStats.nullCount++
        return null
    }

    const sellerName = detailData ? getSellerName(listing, detailData) : null
    const reviewCount = detailData ? getReviewCount(listing, detailData) : null
    const colors = detailData
        ? listing.platform === 'amazon'
            ? extractAmazonColors(detailData)
            : extractEbayColors(detailData)
        : []

    const userPrompt = [
        'Comfrt is a US-based brand selling weighted hoodies, sweatpants, loungewear and athleisure with distinctive named colorways.',
        '',
        'Listing data:',
        `title: ${listing.title}`,
        `platform: ${listing.platform}`,
        `price: ${listing.price ?? 'null'}`,
        `seller name: ${sellerName ?? 'unknown'}`,
        '',
        'Computed context:',
        `titleSimilarity: ${context.titleSimilarity}`,
        `brandPrefix: ${context.brandPrefix}`,
        `priceAnomaly: ${context.priceAnomaly}`,
        '',
        'Detail page data:',
        `review count: ${reviewCount ?? 'unknown'}`,
        `description snippet: ${getDescriptionSnippet(detailData) ?? 'unknown'}`,
        `color variants offered: ${colors.length > 0 ? colors.join(', ') : 'unknown'}`,
        '',
        'Only reference specific numbers such as review counts, prices, or ratings if they are explicitly present in the data provided. Do not invent or infer statistics.',
        '',
        'Return JSON with exactly two fields: score (number 0-1, where 1 = almost certainly an infringement) and reasons (array of 2-4 concise human-readable strings explaining the score).',
    ].join('\n')

    for (let attempt = 1; attempt <= 2; attempt++) {
        llmStats.totalAttempts++
        const startedAt = Date.now()

        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 500,
                    system: 'You are an infringement detection assistant. Respond only with valid JSON. No markdown, no preamble.',
                    messages: [{ role: 'user', content: userPrompt }],
                }),
            })

            const rawText = await res.text()
            if (!res.ok) {
                const errorCode = getAnthropicErrorCode(rawText)
                logLlmError({
                    listingId,
                    message: getAnthropicErrorMessage(rawText) ?? res.statusText,
                    statusCode: res.status,
                    errorCode,
                    latencyMs: Date.now() - startedAt,
                    attempt,
                })

                if (attempt === 1 && isRetryableLlmError(res.status, errorCode)) {
                    llmStats.retryCount++
                    await sleep(randomJitterMs())
                    continue
                }

                llmStats.nullCount++
                return null
            }

            let data: unknown
            try {
                data = JSON.parse(rawText)
            } catch (error) {
                logLlmError({
                    listingId,
                    message: error instanceof Error ? error.message : String(error),
                    statusCode: res.status,
                    errorCode: null,
                    latencyMs: Date.now() - startedAt,
                    attempt,
                })
                llmStats.nullCount++
                return null
            }

            const text = extractAnthropicText(data)
            if (!text) {
                logLlmError({
                    listingId,
                    message: 'Anthropic response did not include text content',
                    statusCode: res.status,
                    errorCode: null,
                    latencyMs: Date.now() - startedAt,
                    attempt,
                })
                llmStats.nullCount++
                return null
            }

            const parsed = parseJsonObject(text)
            if (!isRecord(parsed)) {
                logLlmError({
                    listingId,
                    message: 'Anthropic response text was not a JSON object',
                    statusCode: res.status,
                    errorCode: null,
                    latencyMs: Date.now() - startedAt,
                    attempt,
                })
                llmStats.nullCount++
                return null
            }

            const score = toNumber(parsed.score)
            const reasons = Array.isArray(parsed.reasons)
                ? parsed.reasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 4)
                : []

            if (score === null || reasons.length === 0) {
                logLlmError({
                    listingId,
                    message: 'Anthropic response JSON did not include a valid score and reasons',
                    statusCode: res.status,
                    errorCode: null,
                    latencyMs: Date.now() - startedAt,
                    attempt,
                })
                llmStats.nullCount++
                return null
            }

            llmStats.successCount++
            return { score: clamp01(score), reasons }
        } catch (error) {
            const errorCode = getErrorCode(error)
            logLlmError({
                listingId,
                message: error instanceof Error ? error.message : String(error),
                statusCode: null,
                errorCode,
                latencyMs: Date.now() - startedAt,
                attempt,
            })

            if (attempt === 1 && isRetryableLlmError(null, errorCode)) {
                llmStats.retryCount++
                await sleep(randomJitterMs())
                continue
            }

            llmStats.nullCount++
            return null
        }
    }

    llmStats.nullCount++
    return null
}

function computeFinalScore(signals: ScoredListing['signals'], hasDetailData: boolean): number {
    // Pick the weight table: full detail signals when available, text-only fallback otherwise
    const weights: WeightMap = hasDetailData ? FULL_WEIGHTS : FALLBACK_WEIGHTS

    // imageSimilarity is the only signal that can be null in both weight paths (no imageUrl, or
    // image fetch failed/timed out). Substitute 0.5 (neutral — "no visual evidence either way")
    // so it always participates in the weighted average. This guarantees ≥4 scored signals in
    // every path: titleSimilarity + brandPrefix + priceAnomaly + imageSimilarity are all non-null.
    // The actual null is preserved in signals.imageSimilarity so the UI correctly shows "n/a".
    const IMAGE_SIMILARITY_NEUTRAL = 0.5
    const scoringSignals = {
        ...signals,
        imageSimilarity: signals.imageSimilarity ?? IMAGE_SIMILARITY_NEUTRAL,
    }

    const entries = Object.entries(scoringSignals).filter((entry): entry is [keyof WeightMap, number] => {
        const [key, value] = entry
        return key in weights && typeof value === 'number'
    })

    const totalWeight = entries.reduce((sum, [key]) => sum + (weights as Record<string, number>)[key], 0)
    if (totalWeight === 0) return 0

    const score = entries.reduce((sum, [key, value]) => {
        return sum + value * ((weights as Record<string, number>)[key] / totalWeight)
    }, 0)

    return clamp01(score)
}

function buildFallbackReasons(values: {
    sellerIdentity: number | null
    sellerReputation: number | null
    colorAuthenticity: number | null
    priceAnomaly: number
    brandPrefix: -1 | 0 | 1
}): string[] {
    const reasons: string[] = []

    if (values.sellerIdentity === 0.8) reasons.push('Seller is not a recognized Comfrt-affiliated account')
    if (values.sellerIdentity === 0.2) reasons.push('Seller is a known fast-fashion brand using Comfrt brand name')
    if (values.sellerIdentity === 0.1) reasons.push('Seller appears to be Comfrt or an affiliated account')
    if (values.priceAnomaly >= 0.9) reasons.push('Price is significantly below Comfrt retail range')
    if (values.priceAnomaly === 0.6) reasons.push('Price is moderately below expected retail range')
    if (values.priceAnomaly === 0.3) reasons.push('Price is slightly below expected retail range')
    if (values.colorAuthenticity !== null && values.colorAuthenticity > 0.5) reasons.push("Color variants offered do not match Comfrt's known palette")
    if (values.colorAuthenticity === 0) reasons.push("Color variants match Comfrt's known palette")
    if (values.sellerReputation === 0.9) reasons.push('Seller has very few reviews — newly established listing')
    if (values.sellerReputation === 0.05) reasons.push('Seller has extensive review history')
    if (values.brandPrefix === 1) reasons.push('Title starts with Comfrt brand name')
    if (values.brandPrefix === -1) reasons.push('Title starts with a known fast-fashion brand name')

    return reasons
}

function getSellerName(listing: RawListing, detailData: DetailData): string | null {
    const value =
        listing.platform === 'amazon'
            ? detailData.sold_by
            : getNested(detailData, ['seller', 'name'])

    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getReviewCount(listing: RawListing, detailData: DetailData): number | null {
    return listing.platform === 'amazon'
        ? toNumber(detailData.total_reviews)
        : toNumber(getNested(detailData, ['seller', 'seller_reviews_count']))
}

function extractAmazonColors(detailData: DetailData): string[] {
    const options = detailData.customization_options
    const colors: string[] = []

    if (Array.isArray(options)) {
        for (const option of options) {
            if (!isRecord(option)) continue

            const optionLabel = String(option.name ?? option.type ?? option.dimension ?? option.label ?? '').toLowerCase()
            if (!optionLabel.includes('color')) continue

            collectColorValues(option.options, colors)
            collectColorValues(option.values, colors)
            collectColorValues(option.choices, colors)
            collectColorValues(option.value, colors)
        }
    } else if (isRecord(options)) {
        for (const [key, value] of Object.entries(options)) {
            if (key.toLowerCase().includes('color')) collectColorValues(value, colors)
        }
    }

    return uniqueNonEmpty(colors)
}

function extractEbayColors(detailData: DetailData): string[] {
    const variants = detailData.variants
    if (!Array.isArray(variants)) return []

    const colors: string[] = []
    for (const variant of variants) {
        if (!isRecord(variant)) continue

        const variantType = String(variant.variant_type ?? variant.type ?? '').toLowerCase()
        if (variantType !== 'color') continue

        const color = stringValue(variant.text)
            ?.replace(/\s*\([^)]*(?:out of stock|sold out|unavailable)[^)]*\)\s*$/i, '')
            .trim()

        if (!color || color.toLowerCase() === 'selectselected') continue
        colors.push(color)
    }

    return uniqueNonEmpty(colors)
}

function collectColorValues(value: unknown, colors: string[]): void {
    if (typeof value === 'string') {
        colors.push(value)
        return
    }

    if (Array.isArray(value)) {
        for (const item of value) collectColorValues(item, colors)
        return
    }

    if (isRecord(value)) {
        for (const key of ['name', 'value', 'label', 'display_name']) {
            const nested = value[key]
            if (typeof nested === 'string') colors.push(nested)
        }
    }
}

function getDescriptionSnippet(detailData: DetailData | null): string | null {
    if (!detailData) return null

    const featureBullets = Array.isArray(detailData.feature_bullets)
        ? detailData.feature_bullets.filter((item) => typeof item === 'string').join(' ')
        : null
    const description =
        stringValue(detailData.full_description) ??
        stringValue(detailData.small_description) ??
        featureBullets

    if (!description) return null
    return description.slice(0, 300)
}

function extractAnthropicText(data: unknown): string | null {
    if (!isRecord(data)) return null
    const content = data.content

    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return null

    const text = content
        .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim()

    return text || null
}

function parseJsonObject(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        const match = text.match(/\{[\s\S]*\}/)
        if (!match) return null

        try {
            return JSON.parse(match[0])
        } catch {
            return null
        }
    }
}

function getAnthropicErrorCode(rawText: string): string | null {
    const parsed = parseJsonObject(rawText)
    if (!isRecord(parsed) || !isRecord(parsed.error)) return null

    const code = parsed.error.code ?? parsed.error.type
    return typeof code === 'string' ? code : null
}

function getAnthropicErrorMessage(rawText: string): string | null {
    const parsed = parseJsonObject(rawText)
    if (!isRecord(parsed) || !isRecord(parsed.error)) return null

    const message = parsed.error.message
    return typeof message === 'string' ? message : null
}

function getErrorCode(error: unknown): string | null {
    if (!isRecord(error)) return null

    const code = error.code
    if (typeof code === 'string') return code

    const cause = error.cause
    if (!isRecord(cause)) return null

    const causeCode = cause.code
    return typeof causeCode === 'string' ? causeCode : null
}

function isRetryableLlmError(statusCode: number | null, errorCode: string | null): boolean {
    return statusCode === 429 || errorCode === 'ETIMEDOUT' || errorCode === 'ECONNRESET'
}

function randomJitterMs(): number {
    return 300 + Math.floor(Math.random() * 201)
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    // Note: the inner promise continues running after the timeout resolves —
    // this is intentional. JS has no way to cancel a running promise, and
    // the result is simply discarded. The inner fetch/sharp chain will
    // complete or error independently without affecting the outer resolution.
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(fallback), ms)

        promise
            .then(resolve)
            .catch(() => resolve(fallback))
            .finally(() => clearTimeout(timeout))
    })
}

function logLlmError(error: {
    listingId: string
    message: string
    statusCode: number | null
    errorCode: string | null
    latencyMs: number
    attempt: number
}): void {
    console.error({
        event: 'llm_api_error',
        listingId: error.listingId,
        message: error.message,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        latencyMs: error.latencyMs,
        attempt: error.attempt,
    })
}

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function normalizeColor(value: string): string {
    return normalizeText(value)
}

function uniqueNonEmpty(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function getNested(value: unknown, path: string[]): unknown {
    let current = value
    for (const key of path) {
        if (!isRecord(current)) return undefined
        current = current[key]
    }
    return current
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, ''))
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.min(1, Math.max(0, value))
}
