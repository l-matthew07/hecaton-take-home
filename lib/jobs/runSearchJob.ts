import { scrapeAmazon } from '../marketplace/amazon'
import { scrapeEbay } from '../marketplace/ebay'
import { scoreListing } from '../scoring/scoreListing'
import { scrapeLimit, signalLimit } from './concurrency'
import { resetBudget } from './requestBudget'
import { RawListing, SSEEvent } from '../types'

const QUERIES = [
    'comfrt hoodie',
    'comfrt sweatshirt',
    'comfrt blanket hoodie',
    'comfrt oversized hoodie',
    'comfrt pullover',
    'comfrt sweatpants',
    'comfrt joggers',
    'comfrt dreamer blanket',
    'comfrt crew',
    'comfrt affirmation hoodie',
    'comfrt minimalist hoodie',
    'comfrt signature hoodie',
    'comfrt airplane mode hoodie',
    'comfrt travel essentials',
    'ComfrtCore leggings',
    'ComfrtCore biker shorts',
    'ComfrtCore crop tank',
    'AllDayJersey hoodie',
    'CuddleCloud blanket',
    'comfrt paw hoodie',
    'comfrt anywhere bag',
    'comfrt kids hoodie',
    'comfrt robe',
    'Hoodie Keychain Comfrt',
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
    let timedOut = false

    function isDone() {
        return finished || (signal?.aborted ?? false)
    }

    signal?.addEventListener('abort', () => {
        finished = true
    })

    const timeoutHandle = setTimeout(() => {
        if (!isDone()) {
            timedOut = true
            finished = true
        }
    }, TIMEOUT_MS)

    const statsInterval = setInterval(() => {
        if (!isDone()) {
            send({ type: 'stats', amazon: amazonCount, ebay: ebayCount, elapsed: Date.now() - startTime })
        }
    }, 10_000)

    // Build all scrape tasks upfront
    type ScrapeTask = { label: string; fn: () => Promise<RawListing[]> }
    const scrapeTasks: ScrapeTask[] = []
    for (const query of QUERIES) {
        for (const page of PAGES) {
            scrapeTasks.push({ label: `amazon "${query}" p${page}`, fn: () => scrapeAmazon(query, page) })
            scrapeTasks.push({ label: `ebay "${query}" p${page}`, fn: () => scrapeEbay(query, page) })
        }
    }

    const total = scrapeTasks.length
    let completed = 0

    // Scoring promises accumulate as scrape tasks complete
    const scoringPromises: Promise<void>[] = []

    const scrapePromises = scrapeTasks.map(({ label, fn }) =>
        scrapeLimit(async () => {
            if (isDone()) return

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
                    if (listing.platform === 'amazon') amazonCount++
                    else ebayCount++
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

    if (!(signal?.aborted ?? false) && (timedOut || !isDone())) {
        finished = true
        send({ type: 'stats', amazon: amazonCount, ebay: ebayCount, elapsed: Date.now() - startTime })
        send({ type: 'done' })
    }
}
