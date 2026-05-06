import 'dotenv/config'
import { RawListing } from '../types'
import { increment } from '../jobs/requestBudget'

const API_KEY = process.env.SCRAPERAPI_KEY;

type EbayItem = {
    product_title?: string
    image?: string
    product_url?: string
    item_price?: { value?: number; currency?: string }
}

export async function scrapeEbay(query: string, page: number): Promise<RawListing[]> {
    const url = `https://api.scraperapi.com/structured/ebay/search/v1?api_key=${API_KEY}&query=${encodeURIComponent(query)}&page=${page}`

    increment()
    const res = await fetch(url)
    if (!res.ok) return []

    const data = await res.json() as EbayItem[]
    console.log(Object.keys(data))
    console.log(JSON.stringify(data, null, 2))
    const items = Array.isArray(data) ? data : []

    return items
        .filter((item) => item.product_url?.includes('/itm/'))
        .map((item): RawListing => ({
            id: item.product_url?.split('/itm/')?.[1]?.split('?')?.[0] ?? '',
            platform: 'ebay',
            title: item.product_title ?? '',
            price: item.item_price?.currency === 'USD' ? (item.item_price?.value ?? null) : null,
            brand: null,
            imageUrl: item.image ?? null,
            productUrl: item.product_url ?? null,
        }))
}

// Temporary verification
scrapeEbay('comfrt hoodie', 1).then((results) => {
    console.log('[ebay] comfrt hoodie page 1:', results.length, 'results')
    console.log(JSON.stringify(results.slice(0, 2), null, 2))
})
