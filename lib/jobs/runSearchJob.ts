import { scrapeAmazon } from '../marketplace/amazon'
import { scrapeEbay } from '../marketplace/ebay'
import { scoreListing } from '../scoring/scoreListing'
import { scrapeLimit, signalLimit } from './concurrency'
import { resetBudget } from './requestBudget'
import { RawListing, SSEEvent } from '../types'

const QUERIES = [
    'comfrt hoodie',
    'comfrt sweatshirt',
    'comfrt pullover',
    'comfrt oversized hoodie',
    'comfrt blanket hoodie',
    'comfrt sweatpants',
    'comfrt dreamer blanket',
    'comfrt crew',
    'comfrt paw hoodie',
    'comfrt anywhere bag',
    'comfrt kids hoodie',
    'comfrt robe',
    'comfrt keychain',
    'comfrt carry-on',
    'comfrt travel hoodie',
    'ComfrtCore leggings',
    'ComfrtCore biker shorts',
    'AllDayJersey hoodie',
    'CuddleCloud blanket',
    'Dreamday plush robe',
]

const PAGES = [1, 2]
const TIMEOUT_MS = 4.5 * 60 * 1000

export async function runSearchJob(
    send: (event: SSEEvent) => void,
    signal?: AbortSignal,
): Promise<void> {
    resetBudget()

    const startTime = Date.now()
    const seen = new Set<string>()
    let amazonCount = 0
    let ebayCount = 0
    let finished = false

    function isDone() {
        return finished || (signal?.aborted ?? false)
    }

    signal?.addEventListener('abort', () => {
        finished = true
    })

    const timeoutHandle = setTimeout(() => {
        if (!isDone()) {
            finished = true
        }
    }, TIMEOUT_MS)

    const statsInterval = setInterval(() => {
        if (!isDone()) {
            send({ type: 'stats', amazon: amazonCount, ebay: ebayCount, elapsed: Date.now() - startTime })
        }
    }, 10_000)

    // Build all scrape tasks upfront
    type ScrapeTask = { label: string; platform: RawListing['platform']; fn: () => Promise<RawListing[]> }
    const scrapeTasks: ScrapeTask[] = []
    for (const query of QUERIES) {
        for (const page of PAGES) {
            scrapeTasks.push({ label: `amazon "${query}" p${page}`, platform: 'amazon', fn: () => scrapeAmazon(query, page) })
            scrapeTasks.push({ label: `ebay "${query}" p${page}`, platform: 'ebay', fn: () => scrapeEbay(query, page) })
        }
    }

    const total = scrapeTasks.length
    let completed = 0

    // Scoring promises accumulate as scrape tasks complete
    const scoringPromises: Promise<void>[] = []

    const scrapePromises = scrapeTasks.map(({ label, platform, fn }) =>
        scrapeLimit(async () => {
            if (isDone()) return

            if (platform === 'amazon') amazonCount++
            else ebayCount++
            const listings = await fn().catch(() => [])
            completed++
            send({ type: 'progress', message: `Scraped ${label} — ${listings.length} listings (${completed}/${total})` })

            for (const listing of listings) {
                if (isDone()) break
                if (!listing.id || seen.has(listing.id)) continue
                seen.add(listing.id)
                if (!listing.title.toLowerCase().includes('comfrt')) continue

                const p = signalLimit(async () => {
                    if (isDone()) return
                    const scored = await scoreListing(listing)
                    if (isDone()) return
                    send({ type: 'result', data: scored })
                })
                scoringPromises.push(p)
            }
        }),
    )

    await Promise.all(scrapePromises)
    await Promise.all(scoringPromises)

    clearTimeout(timeoutHandle)
    clearInterval(statsInterval)

    if (!(signal?.aborted ?? false)) {
        finished = true
        send({ type: 'stats', amazon: amazonCount, ebay: ebayCount, elapsed: Date.now() - startTime })
        send({ type: 'done' })
    }
}
