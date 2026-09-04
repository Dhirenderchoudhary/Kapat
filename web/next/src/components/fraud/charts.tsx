"use client"

import { useId, useState } from "react"

/**
 * Charts, hand-built as inline SVG.
 *
 * SERIALISABLE PROPS ONLY. Every value label arrives as a pre-formatted STRING on the datum, never
 * as a formatter function. That is not a style preference: these components are client components
 * rendered from server components, and Next.js cannot serialise a function across that boundary -
 * passing `valueLabel={(v) => ...}` from a server page throws at render time and takes the whole
 * page down with an error boundary. That is exactly what happened to /analysis and /evidence, and
 * the shape of this API is what stops it happening again. Formatting belongs on the server anyway,
 * where the locale and currency rules already live.
 *
 * No chart library: three simple forms on small datasets, and inline SVG inherits the app's theme
 * tokens instead of fighting a library's defaults in dark mode.
 *
 * PALETTE. The three status steps were run through a colour-vision validator and adjusted until
 * every check passed in BOTH modes (lightness band, chroma floor, colourblind separation,
 * normal-vision separation, contrast vs surface):
 *
 *   light  #4a7bb8  #f59e0b  #b91c3c
 *   dark   #5a8ec9  #c08a1c  #e0455f
 *
 * Dark-mode deuteranope separation sits at the low end of the acceptable band, which is permitted
 * only with secondary encoding - so every chart also carries a text label or a legend naming each
 * class in words. Colour is never the sole carrier of meaning.
 */

export const CHART_COLORS = {
  benign_explainable: "var(--chart-benign)",
  weak_fraud_specific: "var(--chart-weak)",
  strong_fraud_specific: "var(--chart-strong)",
} as const

/**
 * Aliases the chart variables onto the evidence tokens in globals.css.
 *
 * These used to be six hardcoded hex values redeclared inside an inline <style> on every page that
 * drew a chart, which meant the charts had their own private palette that the rest of the console
 * knew nothing about. A theme change moved the interface and left the evidence colours behind.
 * Now there is one definition (--evidence-benign / -weak / -strong) and this maps the chart names
 * onto it, so a signal class is the same colour in a chart, on a badge, and on a graph edge.
 *
 * Kept as a component rather than deleted so the existing call sites stay valid, and because
 * scoping the aliases here documents which pages actually draw charts.
 */
export function ChartPalette() {
  return (
    <style>{`
      :root {
        --chart-benign: var(--evidence-benign);
        --chart-weak: var(--evidence-weak);
        --chart-strong: var(--evidence-strong);
        --chart-grid: var(--evidence-grid);
      }
    `}</style>
  )
}

/* ------------------------------------------------------------------ horizontal share bar */

export type ShareSegment = { label: string; value: number; color: string; valueText?: string }

export function ShareBar({ segments, caption }: { segments: ShareSegment[]; caption?: string }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) {
    return <p className="text-muted-foreground text-sm">Nothing ingested yet.</p>
  }

  return (
    <div>
      {/* 2px gaps so adjacent fills stay individually readable. */}
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {segments
          .filter((s) => s.value > 0)
          .map((seg) => (
            <div
              key={seg.label}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }}
              title={`${seg.label}: ${seg.valueText ?? seg.value.toLocaleString("en-IN")}`}
            />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: seg.color }}
            />
            <span>{seg.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {seg.valueText ?? seg.value.toLocaleString("en-IN")} (
              {total ? ((seg.value / total) * 100).toFixed(1) : "0.0"}%)
            </span>
          </li>
        ))}
      </ul>
      {caption && <p className="text-muted-foreground mt-2 text-xs">{caption}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ vertical bar chart */

export type BarDatum = {
  label: string
  value: number
  /** Pre-formatted for display. Server-side formatting keeps this component serialisable. */
  valueText: string
  color?: string
  sublabel?: string
}

export function BarChart({
  data,
  height = 180,
  markerAt,
  markerLabel,
}: {
  data: BarDatum[]
  height?: number
  /** Draw a threshold rule after this index - used to show the flagging cut-off. */
  markerAt?: number
  markerLabel?: string
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const barW = 100 / Math.max(1, data.length)

  if (data.length === 0) return <p className="text-muted-foreground text-sm">No data yet.</p>

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Bar chart: ${data.map((d) => `${d.label} ${d.valueText}`).join(", ")}`}
      >
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1="0"
            x2="100"
            y1={height - t * (height - 24)}
            y2={height - t * (height - 24)}
            stroke="var(--chart-grid)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {markerAt !== undefined && markerAt >= 0 && markerAt < data.length && (
          <line
            x1={(markerAt + 1) * barW}
            x2={(markerAt + 1) * barW}
            y1="0"
            y2={height - 20}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            className="text-muted-foreground"
          />
        )}

        {data.map((d, i) => {
          const h = (d.value / max) * (height - 28)
          return (
            <rect
              key={`${id}-${d.label}-${i}`}
              x={i * barW + barW * 0.18}
              y={height - 20 - h}
              width={barW * 0.64}
              height={Math.max(h, d.value > 0 ? 1.5 : 0)}
              rx="1.5"
              fill={d.color ?? "var(--chart-benign)"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            />
          )
        })}
      </svg>

      <div className="text-muted-foreground mt-1 flex text-[10px]">
        {data.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            className="min-w-0 flex-1 truncate px-0.5 text-center"
            title={d.label}
          >
            {d.label}
          </div>
        ))}
      </div>

      {hover !== null && data[hover] && (
        <div className="bg-popover text-popover-foreground absolute top-0 left-1/2 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs shadow-md">
          <span className="font-medium">{data[hover]!.label}</span>: {data[hover]!.valueText}
          {data[hover]!.sublabel && (
            <span className="text-muted-foreground"> · {data[hover]!.sublabel}</span>
          )}
        </div>
      )}

      {markerLabel && markerAt !== undefined && (
        <p className="text-muted-foreground mt-1.5 text-xs">{markerLabel}</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ ranked horizontal bars */

export type RankedDatum = {
  label: string
  value: number
  valueText: string
  color: string
  note?: string
}

export function RankedBars({ data }: { data: RankedDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  if (data.length === 0)
    return <p className="text-muted-foreground text-sm">No signals recorded yet.</p>

  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{d.label}</span>
            <span className="text-muted-foreground tabular-nums">{d.valueText}</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{ width: `${(d.value / max) * 100}%`, backgroundColor: d.color }}
            />
          </div>
          {d.note && <p className="text-muted-foreground mt-1 text-xs">{d.note}</p>}
        </li>
      ))}
    </ul>
  )
}
