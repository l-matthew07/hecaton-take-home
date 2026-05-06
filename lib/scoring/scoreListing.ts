import { RawListing, ScoredListing } from '../types'

export async function scoreListing(listing: RawListing): Promise<ScoredListing> {
    return {
        ...listing,
        score: 0,
        reasons: [],
        signals: {
            titleSimilarity: null,
            brandInversion: null,
            priceAnomaly: null,
            imageHash: null,
        },
    }
}
