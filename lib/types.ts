export type RawListing = {
    id: string
    platform: 'amazon' | 'ebay'
    title: string
    price: number | null
    brand: string | null
    imageUrl: string | null
    productUrl: string | null
}
