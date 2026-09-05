/**
 * Animated charts, hand-built as CSS + inline SVG.
 * Rendered on the server: CSS drives the motion, so these charts need no hydration.
 *
 * THREE RULES THIS FILE FOLLOWS, EACH FOR A REASON THAT ALREADY BIT US ONCE
 * ------------------------------------------------------------------------
 * 1. SERIALISABLE PROPS ONLY. Every label arrives as a pre-formatted string. These are client
 *    components previously rendered across a client boundary. Keep that simple data contract
 *    shared with the interactive charts; these CSS-only charts now render entirely on the server.
 *
 * 2. THE RESTING STATE IS THE FINISHED STATE. Every animation runs FROM a transformed state TO the
 *    element's ordinary CSS, never the other way round. So if animations never run - reduced
 *    motion, an old browser, JS disabled - the chart still renders complete and correct. Nothing
 *    here is parked at `opacity: 0` waiting for something to wake it up.
 *
 * 3. MOTION IS THE EXPLANATION, NOT DECORATION. The replay grid fills one payment at a time
 *    because that is literally how the detector sees them; the pipeline dot travels because a
 *    payment travels; the bars grow so the eye lands on the height difference. Where motion would
 *    only be ornament, there is none.
 *
 * No chart library: small datasets, simple forms, and inline SVG inherits the app's theme tokens
 * instead of fighting a library's dark-mode defaults.
 */

/** Injected once per page, alongside <ChartPalette/>. Same pattern as charts.tsx. */
export function AnimatedChartStyles() {
  return (
    <style>{`
      @keyframes rd-grow-y { from { transform: scaleY(0); } }
      @keyframes rd-grow-x { from { transform: scaleX(0); } }
      @keyframes rd-fade-up { from { opacity: 0; transform: translateY(8px); } }
      @keyframes rd-pop { from { opacity: 0; transform: scale(0.3); } }
      @keyframes rd-draw { from { stroke-dashoffset: 1; } }
      @keyframes rd-travel {
        0%   { left: 0%;   opacity: 0; }
        6%   { opacity: 1; }
        94%  { opacity: 1; }
        100% { left: 100%; opacity: 0; }
      }
      @keyframes rd-pulse { 50% { opacity: 0.35; } }

      .rd-grow-y  { transform-origin: bottom; animation: rd-grow-y .75s cubic-bezier(.22,1,.36,1) backwards; }
      .rd-grow-x  { transform-origin: left;   animation: rd-grow-x .75s cubic-bezier(.22,1,.36,1) backwards; }
      .rd-fade-up { animation: rd-fade-up .5s ease-out backwards; }
      .rd-pop     { animation: rd-pop .28s cubic-bezier(.34,1.56,.64,1) backwards; }
      .rd-draw    { stroke-dasharray: 1; animation: rd-draw 1.6s ease-out backwards; }
      .rd-travel  { animation: rd-travel 4.5s linear infinite; }
      .rd-pulse   { animation: rd-pulse 2.4s ease-in-out infinite; }

      @media (prefers-reduced-motion: reduce) {
        .rd-grow-y, .rd-grow-x, .rd-fade-up, .rd-pop, .rd-draw, .rd-travel, .rd-pulse {
          animation: none !important;
        }
      }
    `}</style>
  )
}

/* ------------------------------------------------------------------ pipeline */

export type PipelineStep = { title: string; sub: string; accent?: boolean }

/** How a payment becomes a hold. The dot is the payment. */
export function PipelineFlow({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="relative">
      {/* The track the payment travels, behind the cards. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-px lg:block">
        <div className="bg-border h-px w-full" />
        <div className="rd-travel absolute -top-[3px] size-[7px] rounded-full bg-emerald-500 shadow-[0_0_12px_2px] shadow-emerald-500/50" />
      </div>

      <ol className="relative grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={
              "rd-fade-up rounded-xl border p-4 " +
              (s.accent ? "border-emerald-500/40 bg-emerald-500/10" : "bg-card/80 backdrop-blur-sm")
            }
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <div className="text-muted-foreground/70 font-mono text-[10px] tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="text-foreground mt-1 text-sm leading-snug font-semibold">{s.title}</div>
            <div className="text-muted-foreground mt-1 text-xs leading-snug">{s.sub}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ grouped bars */

export type GroupedBarRow = {
  label: string
  /** Each series value as a 0-1 fraction, with its own pre-formatted text. */
  bars: { seriesIndex: number; value: number; valueText: string }[]
  highlight?: boolean
}

/**
 * Two series per row. Used for held-out score versus adversarial score, where the whole point is
 * that one series is flat and the other is not - so the bars grow together and the difference
 * arrives as movement rather than as a sentence.
 */
export function GroupedBars({
  rows,
  series,
  height = 200,
}: {
  rows: GroupedBarRow[]
  series: { label: string; color: string }[]
  height?: number
}) {
  return (
    <div>
      <div
        className="overflow-x-auto"
        role="region"
        aria-label="Model comparison chart"
        tabIndex={0}
      >
        <div className="min-w-[640px]">
          {/* pt-6 is the headroom the value labels sit in: box-sizing is border-box, so the padding
          comes out of the height the bars measure against and a 100% bar cannot clip its label. */}
          <div
            className="border-border/60 flex items-end gap-4 border-b pt-6 sm:gap-8"
            style={{ height }}
            role="img"
            aria-label={rows
              .map(
                (r) =>
                  `${r.label}: ${r.bars.map((b) => `${series[b.seriesIndex]?.label} ${b.valueText}`).join(", ")}`,
              )
              .join(". ")}
          >
            {rows.map((row, ri) => (
              <div key={row.label} className="flex h-full flex-1 items-end justify-center gap-1.5">
                {row.bars.map((b) => {
                  const h = Math.min(Math.max(b.value, 0), 1) * 100
                  return (
                    // The label is positioned against the bar's top edge rather than stacked above it:
                    // stacking would put it inside the scaleY animation and squash it on the way up.
                    <div
                      key={b.seriesIndex}
                      className="relative flex h-full flex-1 flex-col justify-end"
                    >
                      <span
                        className="rd-fade-up text-foreground absolute inset-x-0 text-center text-xs font-medium tabular-nums"
                        style={{
                          bottom: `calc(${h}% + 4px)`,
                          animationDelay: `${400 + ri * 110}ms`,
                        }}
                      >
                        {b.valueText}
                      </span>
                      <div
                        className="rd-grow-y w-full rounded-t-sm"
                        style={{
                          height: `${h}%`,
                          backgroundColor: series[b.seriesIndex]?.color,
                          animationDelay: `${ri * 110 + b.seriesIndex * 55}ms`,
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="mt-2 flex gap-4 sm:gap-8">
            {rows.map((row) => (
              <div
                key={row.label}
                className={
                  "min-w-0 flex-1 text-center text-xs leading-snug break-words " +
                  (row.highlight ? "text-foreground font-semibold" : "text-muted-foreground")
                }
              >
                {row.label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
        {series.map((s) => (
          <li key={s.label} className="text-muted-foreground flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ ranked bars */

export type RankRow = {
  label: string
  /** 0-1 fraction of the widest bar. */
  value: number
  valueText: string
  note?: string
  highlight?: boolean
}

/** Horizontal bars, longest first. Feature importance and the saturation control both use this. */
export function RankBars({ rows }: { rows: RankRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.label} className="grid grid-cols-[minmax(96px,10rem)_1fr] items-center gap-3">
          <span
            className={
              "truncate text-right text-xs sm:text-sm " +
              (r.highlight ? "text-foreground font-semibold" : "text-muted-foreground")
            }
            title={r.label}
          >
            {r.label}
          </span>
          <span className="flex items-center gap-2.5">
            <span className="bg-muted/50 h-6 flex-1 overflow-hidden rounded-[4px]">
              <span
                className="rd-grow-x block h-full rounded-[4px]"
                style={{
                  width: `${Math.max(r.value, 0) * 100}%`,
                  backgroundColor: r.highlight
                    ? "var(--chart-strong)"
                    : "color-mix(in oklab, var(--chart-benign) 78%, transparent)",
                  animationDelay: `${i * 70}ms`,
                }}
              />
            </span>
            <span
              className="rd-fade-up text-foreground w-16 shrink-0 text-xs tabular-nums"
              style={{ animationDelay: `${300 + i * 70}ms` }}
            >
              {r.valueText}
            </span>
            {r.note && (
              <span className="text-muted-foreground hidden w-28 shrink-0 text-xs sm:block">
                {r.note}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ replay grid */

export type ReplayCell = { kind: "held_fraud" | "missed_fraud" | "left_alone" | "held_legit" }

const REPLAY_STYLE: Record<ReplayCell["kind"], { color: string; label: string }> = {
  held_fraud: { color: "var(--chart-strong)", label: "Fraud held" },
  missed_fraud: { color: "var(--chart-weak)", label: "Fraud missed" },
  left_alone: {
    color: "color-mix(in oklab, var(--chart-benign) 45%, transparent)",
    label: "Left alone",
  },
  held_legit: { color: "#8b8b8b", label: "Legitimate held by mistake" },
}

/**
 * One square per payment, filling in the order the payments actually arrived.
 *
 * This is the chart that earns its animation: the detector scores each payment using only what has
 * already landed, so watching the grid fill left-to-right is watching the real thing happen. The
 * amber squares clustering early is the first-sighting effect, visible without a caption.
 */
export function ReplayGrid({
  cells,
  legendOrder,
}: {
  cells: ReplayCell[]
  legendOrder: ReplayCell["kind"][]
}) {
  const counts = cells.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14px, 1fr))" }}
        role="img"
        aria-label={legendOrder.map((k) => `${counts[k] ?? 0} ${REPLAY_STYLE[k].label}`).join(", ")}
      >
        {cells.map((c, i) => (
          <span
            key={i}
            className="rd-pop aspect-square rounded-[3px]"
            style={{
              backgroundColor: REPLAY_STYLE[c.kind].color,
              animationDelay: `${i * 16}ms`,
            }}
            title={`Payment ${i + 1}: ${REPLAY_STYLE[c.kind].label}`}
          />
        ))}
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
        {legendOrder.map((k) => (
          <li key={k} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: REPLAY_STYLE[k].color }}
            />
            <span className="text-muted-foreground">{REPLAY_STYLE[k].label}</span>
            <span className="text-foreground font-medium tabular-nums">{counts[k] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ threshold curve */

export type CurvePoint = { x: number; recall: number; precision: number | null }

/** Precision and recall against the flagging threshold, drawn as the eye would trace them. */
export function ThresholdCurve({
  points,
  selected,
  bandFrom,
  bandTo,
}: {
  points: CurvePoint[]
  selected: number
  bandFrom?: number
  bandTo?: number
}) {
  const xs = points.map((p) => p.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const W = 100
  const H = 46

  const px = (x: number) => ((x - minX) / (maxX - minX || 1)) * W
  const py = (v: number) => H - v * H

  const line = (get: (p: CurvePoint) => number | null) =>
    points
      .filter((p) => get(p) !== null)
      .map(
        (p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(2)},${py(get(p) as number).toFixed(2)}`,
      )
      .join(" ")

  return (
    <div>
      <svg
        viewBox={`-3 -5 ${W + 6} ${H + 14}`}
        className="w-full"
        style={{ maxHeight: 260 }}
        role="img"
        aria-label={`Precision and recall against flagging threshold; ${selected} selected on the training split`}
      >
        {bandFrom !== undefined && bandTo !== undefined && (
          <rect
            x={px(bandFrom)}
            y={0}
            width={Math.max(px(bandTo) - px(bandFrom), 0)}
            height={H}
            fill="var(--chart-benign)"
            opacity={0.1}
          />
        )}

        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={py(g)}
            y2={py(g)}
            stroke="var(--chart-grid)"
            strokeWidth={0.3}
          />
        ))}

        <path
          d={line((p) => p.precision)}
          fill="none"
          stroke="var(--chart-weak)"
          strokeWidth={1.1}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="rd-draw"
        />
        <path
          d={line((p) => p.recall)}
          fill="none"
          stroke="var(--chart-strong)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="rd-draw"
          style={{ animationDelay: "150ms" }}
        />

        <line
          x1={px(selected)}
          x2={px(selected)}
          y1={-2}
          y2={H}
          stroke="currentColor"
          strokeWidth={0.35}
          strokeDasharray="1.5 1.5"
          className="rd-fade-up text-foreground"
          style={{ animationDelay: "1.4s" }}
        />
        <circle
          cx={px(selected)}
          cy={py(1)}
          r={1.5}
          fill="var(--chart-strong)"
          className="rd-pop"
          style={{ animationDelay: "1.5s" }}
        />
        <text
          x={px(selected)}
          y={H + 9}
          textAnchor="middle"
          fontSize={4}
          fill="currentColor"
          className="rd-fade-up text-foreground"
          style={{ animationDelay: "1.5s" }}
        >
          {selected}
        </text>
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {[
          { label: "Rings caught", color: "var(--chart-strong)" },
          { label: "Flags that were rings", color: "var(--chart-weak)" },
        ].map((s) => (
          <li key={s.label} className="text-muted-foreground flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-[3px] w-4 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ signal chips */

export type SignalChip = { label: string; weight: string; fraudSpecific: boolean }

/** The five signals and their corroboration weights. The whole scoring model, in one row. */
export function SignalKey({ signals }: { signals: SignalChip[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {signals.map((s, i) => (
        <li
          key={s.label}
          className={
            "rd-fade-up flex items-baseline gap-2 rounded-full border px-3 py-1.5 text-xs " +
            (s.fraudSpecific
              ? "border-rose-500/40 bg-rose-500/5"
              : "bg-card/60 text-muted-foreground")
          }
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <span className={s.fraudSpecific ? "text-foreground" : undefined}>{s.label}</span>
          <span
            className={
              "font-mono tabular-nums " +
              (s.fraudSpecific ? "text-rose-600 dark:text-rose-400" : "text-foreground/70")
            }
          >
            {s.weight}
          </span>
        </li>
      ))}
    </ul>
  )
}
