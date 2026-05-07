import 'dotenv/config'
import { RawListing } from '../types'

const API_KEY = process.env.SCRAPERAPI_KEY;

type EbayItem = {
    product_title?: string
    image?: string
    product_url?: string
    item_price?: { value?: number | string; currency?: string } | string
}

export async function scrapeEbay(query: string, page: number): Promise<RawListing[]> {
    const url = `https://api.scraperapi.com/structured/ebay/search/v1?api_key=${API_KEY}&query=${encodeURIComponent(query)}&page=${page}`

    const res = await fetch(url)
    if (!res.ok) return []

    const data = await res.json() as EbayItem[]
    console.log(Object.keys(data))
    console.log(JSON.stringify(data, null, 2))
    const items = Array.isArray(data) ? data : []

    return items
        .filter((item) => item.product_url?.includes('/itm/'))
        .map((item): RawListing => ({
            id: getEbayItemId(item.product_url),
            platform: 'ebay',
            title: item.product_title ?? '',
            price: getEbayPrice(item.item_price),
            brand: null,
            imageUrl: item.image ?? null,
            productUrl: item.product_url ?? null,
        }))
}

function getEbayItemId(productUrl: string | undefined): string {
    if (!productUrl) return ''

    const path = productUrl.split('?')[0]
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? ''
}

function getEbayPrice(itemPrice: EbayItem['item_price']): number | null {
    if (typeof itemPrice === 'string') {
        const parsed = Number(itemPrice.replace(/[^0-9.]/g, ''))
        return Number.isFinite(parsed) ? parsed : null
    }

    if (!itemPrice || itemPrice.currency !== 'USD') return null

    if (typeof itemPrice.value === 'number') return itemPrice.value
    if (typeof itemPrice.value === 'string') {
        const parsed = Number(itemPrice.value.replace(/[^0-9.]/g, ''))
        return Number.isFinite(parsed) ? parsed : null
    }

    return null
}

// Temporary verification
//scrapeEbay('comfrt hoodie', 1).then((results) => {
//    console.log('[ebay] comfrt hoodie page 1:', results.length, 'results')
//    console.log(JSON.stringify(results.slice(0, 2), null, 2))
//})
