"use client"

import { useMemo, useRef, useState } from "react"
import type { ScoredListing, SSEEvent } from "../lib/types"

type PlatformFilter = "all" | ScoredListing["platform"]
type SortDirection = "desc" | "asc"

const platformLabels: Record<ScoredListing["platform"], string> = {
    amazon: "Amazon",
    ebay: "eBay",
}

const signalLabels: Record<keyof ScoredListing["signals"], string> = {
  sellerIdentity: "Seller identity",
  sellerReputation: "Seller reputation",
  colorAuthenticity: "Color authenticity",
  llmJudgment: "LLM judgment",
}

const priceFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
})

function formatElapsed(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    if (minutes === 0) return `${seconds}s`
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`
}

function formatPrice(price: number | null) {
    if (price === null) return "Price unavailable"
    return priceFormatter.format(price)
}

function formatScore(score: number) {
    const percent = score <= 1 ? score * 100 : score
    return `${Math.round(percent)}%`
}

function formatSignalValue(value: number | string | boolean | null | undefined) {
    if (value === null || value === undefined) return "n/a"
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3)
    return String(value)
}

export default function Home() {
    const [isRunning, setIsRunning] = useState(false)
    const [results, setResults] = useState<ScoredListing[]>([])
    const [progress, setProgress] = useState("Idle")
    const [stats, setStats] = useState({ amazon: 0, ebay: 0, elapsed: 0 })
    const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all")
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
    const eventSourceRef = useRef<EventSource | null>(null)

    const filteredResults = useMemo(() => {
        return results
            .filter((result) => platformFilter === "all" || result.platform === platformFilter)
            .toSorted((a, b) => (sortDirection === "desc" ? b.score - a.score : a.score - b.score))
    }, [platformFilter, results, sortDirection])

    function stopJob() {
        eventSourceRef.current?.close()
        eventSourceRef.current = null
        setIsRunning(false)
    }

    function startJob() {
        if (isRunning) return

        eventSourceRef.current?.close()
        setResults([])
        setExpandedIds(new Set())
        setStats({ amazon: 0, ebay: 0, elapsed: 0 })
        setProgress("Starting infringement scan...")
        setIsRunning(true)

        const source = new EventSource("/api/job")
        eventSourceRef.current = source

        source.onmessage = (message) => {
            let event: SSEEvent
            try {
                event = JSON.parse(message.data) as SSEEvent
            } catch {
                setProgress("Received an unreadable stream event")
                return
            }

            if (event.type === "result") {
                setResults((current) => [...current, event.data])
                return
            }

            if (event.type === "progress") {
                setProgress(event.message)
                return
            }

            if (event.type === "stats") {
                setStats({ amazon: event.amazon, ebay: event.ebay, elapsed: event.elapsed })
                return
            }

            if (event.type === "done") {
                setProgress("Scan complete")
                stopJob()
            }
        }

        source.onerror = () => {
            setProgress("Stream connection closed before completion")
            stopJob()
        }
    }

    function toggleExpanded(id: string) {
        setExpandedIds((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const totalRequests = stats.amazon + stats.ebay

    return (
        <main className="page-shell">
            <section className="topbar" aria-label="Scan controls">
                <div>
                    <p className="eyebrow">Infringement Detection</p>
                    <h1>Marketplace scan</h1>
                </div>
                <button className="run-button" type="button" onClick={startJob} disabled={isRunning}>
                    {isRunning ? "Running..." : "Run scan"}
                </button>
            </section>

            <section className="status-grid" aria-label="Live job status">
                <div className="metric">
                    <span className="metric-label">Elapsed</span>
                    <strong>{formatElapsed(stats.elapsed)}</strong>
                </div>
                <div className="metric">
                    <span className="metric-label">Amazon</span>
                    <strong>{stats.amazon}</strong>
                </div>
                <div className="metric">
                    <span className="metric-label">eBay</span>
                    <strong>{stats.ebay}</strong>
                </div>
                <div className="metric">
                    <span className="metric-label">Total</span>
                    <strong>{totalRequests}</strong>
                </div>
            </section>

            <section className="progress-panel" aria-live="polite">
                <span>Progress</span>
                <p>{progress}</p>
            </section>

            <section className="results-section" aria-label="Scored listings">
                <div className="results-header">
                    <div>
                        <h2>Results</h2>
                        <p>
                            Showing {filteredResults.length} of {results.length} streamed listings
                        </p>
                    </div>

                    <div className="controls">
                        <div className="segmented" aria-label="Filter by platform">
                            {(["all", "amazon", "ebay"] as PlatformFilter[]).map((platform) => (
                                <button
                                    key={platform}
                                    type="button"
                                    className={platformFilter === platform ? "active" : ""}
                                    onClick={() => setPlatformFilter(platform)}
                                >
                                    {platform === "all" ? "All" : platformLabels[platform]}
                                </button>
                            ))}
                        </div>

                        <label className="sort-control">
                            <span>Sort</span>
                            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
                                <option value="desc">Highest score</option>
                                <option value="asc">Lowest score</option>
                            </select>
                        </label>
                    </div>
                </div>

                <div className="results-list">
                    {filteredResults.length === 0 ? (
                        <div className="empty-state">
                            <h3>No listings yet</h3>
                            <p>Start a scan to stream scored marketplace listings into this view.</p>
                        </div>
                    ) : (
                        filteredResults.map((result) => {
                            const isExpanded = expandedIds.has(result.id)

                            return (
                                <article className="result-card" key={result.id}>
                                    <button
                                        className="result-summary"
                                        type="button"
                                        aria-expanded={isExpanded}
                                        onClick={() => toggleExpanded(result.id)}
                                    >
                                        <span className="thumbnail-wrap">
                                            {result.imageUrl ? (
                                                <img src={result.imageUrl} alt="" loading="lazy" />
                                            ) : (
                                                <span className="thumbnail-empty">No image</span>
                                            )}
                                        </span>

                                        <span className="result-main">
                                            <span className="result-title">{result.title}</span>
                                            <span className="result-meta">
                                                <span className={`badge ${result.platform}`}>{platformLabels[result.platform]}</span>
                                                <span>{formatPrice(result.price)}</span>
                                            </span>
                                        </span>

                                        <span className="score-block">
                                            <span>{formatScore(result.score)}</span>
                                            <small>score</small>
                                        </span>
                                    </button>

                                    {isExpanded ? (
                                        <div className="expanded-panel">
                                            <div>
                                                <h3>Signal breakdown</h3>
                                                <dl className="signals">
                                                    {Object.entries(result.signals).map(([key, value]) => (
                                                        <div key={key}>
                                                            <dt>{signalLabels[key as keyof ScoredListing["signals"]] ?? key}</dt>
                                                            <dd>{formatSignalValue(value)}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                            </div>

                                            <div>
                                                <h3>Supporting data</h3>
                                                <dl className="signals">
                                                    <div>
                                                        <dt>Title similarity</dt>
                                                        <dd>{result.titleSimilarity}</dd>
                                                    </div>
                                                    <div>
                                                        <dt>Brand prefix</dt>
                                                        <dd>{result.brandPrefix}</dd>
                                                    </div>
                                                    <div>
                                                        <dt>Price anomaly</dt>
                                                        <dd>{result.priceAnomaly}</dd>
                                                    </div>
                                                </dl>
                                            </div>

                                            <div>
                                                <h3>Reasons</h3>
                                                {result.reasons.length > 0 ? (
                                                    <ul className="reasons">
                                                        {result.reasons.map((reason, index) => (
                                                            <li key={`${result.id}-reason-${index}`}>{reason}</li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="muted">No reasons reported yet.</p>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                </article>
                            )
                        })
                    )}
                </div>
            </section>

            <style>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #f5f7f8;
          color: #172026;
          font-family:
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        button,
        select {
          font: inherit;
        }

        .page-shell {
          min-height: 100vh;
          padding: 32px;
        }

        .topbar {
          align-items: center;
          display: flex;
          gap: 24px;
          justify-content: space-between;
          margin: 0 auto 24px;
          max-width: 1180px;
        }

        .eyebrow {
          color: #64717a;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
          margin: 0 0 6px;
          text-transform: uppercase;
        }

        h1,
        h2,
        h3,
        p {
          margin: 0;
        }

        h1 {
          font-size: 34px;
          line-height: 1.1;
        }

        h2 {
          font-size: 22px;
        }

        h3 {
          font-size: 14px;
          line-height: 1.2;
        }

        .run-button {
          background: #173f35;
          border: 1px solid #173f35;
          border-radius: 8px;
          color: white;
          cursor: pointer;
          font-weight: 700;
          min-width: 132px;
          padding: 12px 18px;
        }

        .run-button:disabled {
          background: #9da8ad;
          border-color: #9da8ad;
          cursor: not-allowed;
        }

        .status-grid,
        .progress-panel,
        .results-section {
          margin-left: auto;
          margin-right: auto;
          max-width: 1180px;
        }

        .status-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 16px;
        }

        .metric,
        .progress-panel,
        .result-card,
        .empty-state {
          background: #ffffff;
          border: 1px solid #dfe6e9;
          border-radius: 8px;
        }

        .metric {
          padding: 18px;
        }

        .metric-label,
        .progress-panel span,
        .sort-control span,
        .score-block small {
          color: #66737d;
          display: block;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .metric strong {
          display: block;
          font-size: 28px;
          line-height: 1.1;
          margin-top: 8px;
        }

        .progress-panel {
          margin-bottom: 28px;
          padding: 18px 20px;
        }

        .progress-panel p {
          font-size: 15px;
          line-height: 1.5;
          margin-top: 6px;
        }

        .results-section {
          padding-bottom: 32px;
        }

        .results-header {
          align-items: end;
          display: flex;
          gap: 20px;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .results-header p {
          color: #64717a;
          font-size: 14px;
          margin-top: 4px;
        }

        .controls {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: flex-end;
        }

        .segmented {
          background: #e8eef0;
          border: 1px solid #d5dee2;
          border-radius: 8px;
          display: flex;
          padding: 3px;
        }

        .segmented button {
          background: transparent;
          border: 0;
          border-radius: 6px;
          color: #40505a;
          cursor: pointer;
          font-size: 14px;
          font-weight: 700;
          min-width: 74px;
          padding: 8px 10px;
        }

        .segmented button.active {
          background: #ffffff;
          color: #172026;
          box-shadow: 0 1px 2px rgba(23, 32, 38, 0.12);
        }

        .sort-control {
          align-items: center;
          display: flex;
          gap: 8px;
        }

        .sort-control select {
          background: #ffffff;
          border: 1px solid #cfd9de;
          border-radius: 8px;
          color: #172026;
          cursor: pointer;
          padding: 9px 12px;
        }

        .results-list {
          display: grid;
          gap: 10px;
        }

        .empty-state {
          padding: 40px;
          text-align: center;
        }

        .empty-state p,
        .muted {
          color: #66737d;
          margin-top: 8px;
        }

        .result-card {
          overflow: hidden;
        }

        .result-summary {
          align-items: center;
          background: #ffffff;
          border: 0;
          color: inherit;
          cursor: pointer;
          display: grid;
          gap: 16px;
          grid-template-columns: 76px minmax(0, 1fr) 86px;
          padding: 14px;
          text-align: left;
          width: 100%;
        }

        .result-summary:hover {
          background: #f9fbfb;
        }

        .thumbnail-wrap {
          align-items: center;
          aspect-ratio: 1;
          background: #eef2f3;
          border: 1px solid #dce4e7;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          overflow: hidden;
          width: 76px;
        }

        .thumbnail-wrap img {
          height: 100%;
          object-fit: cover;
          width: 100%;
        }

        .thumbnail-empty {
          color: #74818a;
          font-size: 12px;
          font-weight: 700;
          text-align: center;
        }

        .result-main {
          min-width: 0;
        }

        .result-title {
          display: -webkit-box;
          font-size: 15px;
          font-weight: 750;
          line-height: 1.35;
          overflow: hidden;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .result-meta {
          align-items: center;
          color: #52616b;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }

        .badge {
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          padding: 4px 8px;
        }

        .badge.amazon {
          background: #fff3d9;
          color: #7a4d00;
        }

        .badge.ebay {
          background: #e2f4ff;
          color: #07547a;
        }

        .score-block {
          align-items: flex-end;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .score-block span {
          font-size: 24px;
          font-weight: 850;
          line-height: 1;
        }

        .expanded-panel {
          border-top: 1px solid #e2e9ec;
          display: grid;
          gap: 24px;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          padding: 18px;
        }

        .signals {
          display: grid;
          gap: 8px;
          margin: 12px 0 0;
        }

        .signals div {
          align-items: center;
          background: #f6f8f9;
          border: 1px solid #e2e9ec;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          padding: 10px 12px;
        }

        .signals dt {
          color: #52616b;
          font-size: 13px;
          font-weight: 700;
        }

        .signals dd {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 13px;
          margin: 0;
        }

        .reasons {
          color: #34424a;
          line-height: 1.45;
          margin: 12px 0 0;
          padding-left: 20px;
        }

        @media (max-width: 780px) {
          .page-shell {
            padding: 20px;
          }

          .topbar,
          .results-header {
            align-items: stretch;
            flex-direction: column;
          }

          .run-button {
            width: 100%;
          }

          .status-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .controls {
            justify-content: stretch;
          }

          .segmented,
          .sort-control,
          .sort-control select {
            width: 100%;
          }

          .segmented button {
            flex: 1;
            min-width: 0;
          }

          .result-summary {
            grid-template-columns: 64px minmax(0, 1fr);
          }

          .thumbnail-wrap {
            width: 64px;
          }

          .score-block {
            align-items: flex-start;
            grid-column: 2;
          }

          .expanded-panel {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 460px) {
          .page-shell {
            padding: 16px;
          }

          h1 {
            font-size: 28px;
          }

          .status-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
        </main>
    )
}
