import 'dotenv/config'
import { RawListing } from '../types'
import { increment, isOverBudget } from '../jobs/requestBudget'

const API_KEY = process.env.SCRAPERAPI_KEY;

type AmazonProduct = {
    asin?: string
    name?: string
    image?: string
    url?: string
    price?: number
}
type AmazonResponse = {
    results?: AmazonProduct[]
    search_results?: AmazonProduct[]
}

export async function scrapeAmazon(query: string, page: number): Promise<RawListing[]> {
    const url = `https://api.scraperapi.com/structured/amazon/search/v1?api_key=${API_KEY}&query=${encodeURIComponent(query)}&page=${page}&tld=com`

    if (isOverBudget()) {
        console.warn({ event: 'scraperapi_budget_skip', requestType: 'amazon_search', query, page })
        return []
    }

    increment()
    const res = await fetch(url)
    if (!res.ok) return []

    const data: AmazonResponse = await res.json()
    console.log(JSON.stringify(data, null, 2))
    const products = data.results ?? data.search_results ?? []

    return products
        .filter((p) => p.asin)
        .map((p): RawListing => ({
            id: p.asin!,
            platform: 'amazon',
            title: p.name ?? '',
            price: p.price ?? null,
            brand: null,
            imageUrl: p.image ?? null,
            productUrl: p.url ?? null,
        }))
}

// Temporary verification
//scrapeAmazon('comfrt hoodie', 1).then((results) => {
//    console.log('[amazon] comfrt hoodie page 1:', results.length, 'results')
//    console.log(JSON.stringify(results.slice(0, 2), null, 2))
//})
