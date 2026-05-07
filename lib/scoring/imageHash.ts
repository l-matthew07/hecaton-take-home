import sharp from 'sharp'

const REFERENCE_IMAGE_URLS = [
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Berry_Hoodie_7.jpg?v=1728784652',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_4e5c22bd-d0bf-4c02-8281-0cb1c8d238e4.jpg?v=1762181891',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitled_design_19_1.jpg?v=1729528302',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/CLOUD_GREY.jpg?v=1762181917',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_2e82fd23-8ed8-49ec-aa02-1a28f589ee5d.jpg?v=1776976033',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_-_2026-02-11T110757.055.jpg?v=1770847341',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_2422a1bf-380f-4a92-b9c9-65786008a9a8.jpg?v=1762181937',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_188172fb-587d-400d-b1cc-eab01099e24a.jpg?v=1762181960',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_a5dfce24-ff93-407f-a43b-f893887dc5a7.jpg?v=1777920777',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/2_1bd7a5e4-0160-4c13-98f9-e89c31d6af05.jpg?v=1776895262',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_537e8718-b459-49bb-9b2c-fa17ac67b981.jpg?v=1776904656',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_626e4d6c-0c5b-4dba-bb3c-b4fcd3917e8c.jpg?v=1777327908',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_1c896dc2-3888-4689-9309-4a0fe6054d84.jpg?v=1775589225',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_232448b1-efc8-482f-9e8c-4d0c45547bb6.jpg?v=1776703135',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/10_3ad2a8d5-9890-4ce5-8a95-cf911527a7cd.jpg?v=1776700879',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_16fc6b44-deaf-45f1-ac7d-0dadb37cdd9f.jpg?v=1718878307',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesigncopy_df5a9205-a11a-4674-b89f-5e6814855bf4.jpg?v=1776808963',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_945189b4-44fe-4008-96c0-a4a2ced32765.jpg?v=1776119355',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_ebc31416-cab1-4a39-9ff2-1d2e6e1f94f4.jpg?v=1762181953',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_c3124cb3-1d6a-46d3-85ba-083cb62e39c7.jpg?v=1774889347',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_187c27ad-1e6b-4dc4-a743-cad5492678c0.jpg?v=1772747161',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_ebc166a7-93ad-4b23-a75c-cf7d7adca2e8.jpg?v=1746811828',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_8df477db-c542-4d49-bdfa-075a64b8b89c.jpg?v=1748357770',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_d42c6737-1cac-4d93-b495-9d512e88aeb1.jpg?v=1774887864',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/ComfrtClubVIPLogo.jpg?v=1775584532',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_74b53d33-b498-44f1-bd39-6b87f9adc9b0.jpg?v=1771881817',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_c58c412a-8999-4f9a-abc8-a36a0215a368.jpg?v=1746732616',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_8fd03e04-b7f0-4e46-837e-f5a369965fca.jpg?v=1771525907',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_92dd5438-12fb-4bc0-8d6c-8caf3ff54d88.jpg?v=1771361527',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_-_2026-02-10T110458.319_1d2fdd26-6b29-4538-8b26-93fc7da29da8.jpg?v=1770759129',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_5c7a8fd5-8374-44a3-b90f-e9f1ce9b83ee.jpg?v=1771356282',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_5c4c8b51-f8eb-4e4c-a9e8-8d855ea671e4.jpg?v=1770419100',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_a0b24e8d-24c3-49aa-9a46-e2e8a2e3d3e5.jpg?v=1770416700',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_93e7b1b4-e1e2-4e5e-a456-e8ecd9c7f35b.jpg?v=1770414400',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_3e53e83e-8b58-4dba-946e-e1c8be7d4d98.jpg?v=1770412900',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_b2d34e8b-3e5d-4e8a-9c59-b3e8e5bc3d5a.jpg?v=1770411000',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_d4e5f0c3-7b63-4e54-9c38-d6e2f1c9e9a6.jpg?v=1770409200',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_e28b5a5f-7b83-4b92-a8d2-5d4c4e0e6d50.jpg?v=1770406500',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_9f5b3c8e-5c4d-4e50-8a7c-6f4e3d2c1b9a.jpg?v=1770403200',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/bundle_comfrt.png?v=1761318121',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Berry_Sweatpants_2.jpg?v=1725574988',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_b194e13e-47e4-4265-b16f-597f8cea4bc5.jpg?v=1743613856',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_4_0c168264-f4d1-4dbc-89a6-360d1a4a8b3c.jpg?v=1762181920',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_4_5c6dd364-8a6e-4d0b-acb6-45596ae8a33b.jpg?v=1720867013',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitled_design_13.jpg?v=1720867961',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_4_fa571462-2ec7-4128-8c3a-956720bbe83f.jpg?v=1762181911',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/White_Oak_2_1.jpg?v=1762181903',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/White_Oak_6_1.jpg?v=1762181902',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/White_Oak_13_1.jpg?v=1762181903',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_63d9ad88-e278-451c-ab71-6a5f726e56c3.jpg?v=1762181918',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_1_a06be5ea-f6d7-49a4-b665-bd8d9c58b73d.jpg?v=1762181918',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_15_42960645-e08a-4893-a7d3-aec00ed1c6d6.jpg?v=1762181888',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_14_5cb8b5fd-f578-47ca-9f28-131ee8963d4c.jpg?v=1770424279',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitled_design_1_8d7fc94d-41be-4724-ad67-630e241511c5.jpg?v=1720865776',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_52_b5fd00a9-4726-456b-901b-a784873dd534.jpg?v=1715029881',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_15_2.jpg?v=1770852416',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_2_49e12706-9bbf-4f5d-a135-9e033aa93fdf.jpg?v=1762181917',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_4f08baf7-77e5-412d-b305-1dfd5d5af2cd.jpg?v=1762181916',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Untitleddesign_12.jpg?v=1762181916',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/e_25.jpg?v=1762181896',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/1_348f9cb1-5ac4-4e39-b6ac-4924d2389ef4.jpg?v=1773095312',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/13.jpg?v=1775954549',
    'https://cdn.shopify.com/s/files/1/0569/4029/8284/files/Coordinate_Mist_1.jpg?v=1726189270',
]

let referenceHashesCache: Promise<bigint[]> | null = null

export async function computePerceptualHash(imageUrl: string): Promise<bigint | null> {
    try {
        const res = await fetch(imageUrl)
        if (!res.ok) return null

        const imageBuffer = Buffer.from(await res.arrayBuffer())
        const pixels = await sharp(imageBuffer)
            .resize(8, 8, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer()

        const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length
        let hash = BigInt(0)

        for (let index = 0; index < pixels.length; index++) {
            if (pixels[index] > mean) hash |= BigInt(1) << BigInt(index)
        }

        return hash
    } catch {
        return null
    }
}

export function hammingDistance(a: bigint, b: bigint): number {
    const xor = a ^ b
    // Split into two 32-bit halves and use integer popcount for speed.
    // BigInt bitwise ops in a 64-iteration loop are ~10x slower.
    const MASK32 = BigInt(0xFFFFFFFF)
    const lo = Number(xor & MASK32)
    const hi = Number((xor >> BigInt(32)) & MASK32)
    return popcount32(lo) + popcount32(hi)
}

function popcount32(n: number): number {
    n = n - ((n >> 1) & 0x55555555)
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333)
    return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function getReferenceHashes(): Promise<bigint[]> {
    if (!referenceHashesCache) {
        referenceHashesCache = Promise.all(REFERENCE_IMAGE_URLS.map((url) => computePerceptualHash(url)))
            .then((hashes) => hashes.filter((hash): hash is bigint => hash !== null))
    }

    return referenceHashesCache
}

export async function computeImageSimilarity(listingImageUrl: string): Promise<number | null> {
    const listingHash = await computePerceptualHash(listingImageUrl)
    if (listingHash === null) return null

    const referenceHashes = await getReferenceHashes()
    if (referenceHashes.length === 0) return null

    const minDistance = Math.min(...referenceHashes.map((hash) => hammingDistance(listingHash, hash)))
    return 1 - minDistance / 64
}
