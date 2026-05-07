export type RawListing = {
    id: string
    platform: 'amazon' | 'ebay'
    title: string
    price: number | null
    brand: string | null
    imageUrl: string | null
    productUrl: string | null
}

export type ScoredListing = RawListing & {
    score: number
    reasons: string[]
    llmReasons: string[]
    titleSimilarity: number
    brandPrefix: -1 | 0 | 1
    priceAnomaly: number
    signals: {
        sellerIdentity: number | null
        sellerReputation: number | null
        colorAuthenticity: number | null
        priceAnomaly: number | null
        llmJudgment: number | null
        imageSimilarity: number | null
    }
}

export type SSEEvent =
    | { type: 'result'; data: ScoredListing }
    | { type: 'progress'; message: string }
    | { type: 'stats'; amazon: number; ebay: number; elapsed: number }
    | { type: 'done' }
