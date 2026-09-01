"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  SIGNAL_CLASS_LABEL,
  SIGNAL_LABEL,
  signalClassOf,
  type SignalClass,
} from "@/components/fraud/signal-taxonomy"

// react-force-graph-2d touches the DOM/canvas directly - never render it during SSR (Design.md
// 1.2/2: this is the ring detail view's core evidence display, not decorative, so it has to
// actually mount client-side rather than silently no-op on the server).
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false })

export type GraphAccount = {
  id: string
  customerRef: string
  transactionCount: number
  avgSignalConfidence: number
}

export type GraphEvidence = {
  id: string
  accountA: string
  accountB: string
  signalType: string
  confidence: number
}

/**
 * Edge colour carries the SIGNAL CLASS, not the confidence.
 *
 * The previous version drew every edge in the same violet, shaded by confidence. That threw away
 * the single most important thing this product knows: a 0.90-confidence shared address and a
 * 0.75-confidence sequential SIM block are wildly different evidence, and colouring them the same
 * hue makes the picture argue that a family and a fraud ring look alike - the exact opposite of
 * what the detector concluded.
 *
 * The ramp is ordinal and escalating (neutral -> amber -> red) and never the only carrier of
 * meaning: there is a legend under the canvas, the hover tooltip names the signal and its class in
 * words, and line weight rises with class too. Confidence still shows up, as opacity.
 */
const CLASS_COLOR: Record<SignalClass, { h: number; s: number; l: number }> = {
  benign_explainable: { h: 215, s: 14, l: 52 },
  weak_fraud_specific: { h: 38, s: 92, l: 46 },
  strong_fraud_specific: { h: 0, s: 72, l: 51 },
}

const CLASS_WIDTH: Record<SignalClass, number> = {
  benign_explainable: 1,
  weak_fraud_specific: 2,
  strong_fraud_specific: 3,
}

function edgeColor(signalType: string, confidence: number): string {
  const { h, s, l } = CLASS_COLOR[signalClassOf(signalType)]
  const alpha = 0.35 + confidence * 0.5
  return `hsla(${h}, ${s}%, ${l}%, ${alpha.toFixed(2)})`
}

const LEGEND: { cls: SignalClass; note: string }[] = [
  { cls: "strong_fraud_specific", note: "No ordinary household does this" },
  { cls: "weak_fraud_specific", note: "Households sometimes do this" },
  { cls: "benign_explainable", note: "Families and flatmates do this routinely" },
]

export function ClusterNetworkGraph({
  accounts,
  evidence,
}: {
  accounts: GraphAccount[]
  evidence: GraphEvidence[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [width, setWidth] = useState(0)
  const height = 420

  // react-force-graph defaults to the WINDOW width when none is given, which is why the graph
  // rendered as a small clump floating off-centre inside its card. Measure the actual container
  // and keep it in sync on resize.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { nodes, links, presentClasses } = useMemo(() => {
    const maxTxns = Math.max(1, ...accounts.map((a) => a.transactionCount))
    const nodes = accounts.map((a) => ({
      id: a.id,
      // customerRef is long; the short form is what fits on a node, the full value is in the tooltip.
      label: a.customerRef.replace(/^cust_/, ""),
      fullLabel: a.customerRef,
      transactionCount: a.transactionCount,
      // Design.md 2: node size is proportional to transaction volume. Normalised so one heavy
      // account can't blow the others off the canvas.
      radius: 5 + (a.transactionCount / maxTxns) * 5,
    }))

    // Fan out parallel edges (several signal types between the same pair) with alternating
    // curvature so every one stays independently visible and hoverable - Principle 9 requires each
    // signal to show its own label, so collapsing them into one line isn't an option.
    const pairIndex = new Map<string, number>()
    const links = evidence.map((e) => {
      const key = [e.accountA, e.accountB].sort().join("::")
      const i = pairIndex.get(key) ?? 0
      pairIndex.set(key, i + 1)
      const curvature = i === 0 ? 0 : Math.ceil(i / 2) * 0.22 * (i % 2 === 0 ? -1 : 1)
      const cls = signalClassOf(e.signalType)
      return {
        id: e.id,
        source: e.accountA,
        target: e.accountB,
        signalType: e.signalType,
        confidence: e.confidence,
        signalClass: cls,
        curvature,
        color: edgeColor(e.signalType, e.confidence),
        width: CLASS_WIDTH[cls],
      }
    })

    const presentClasses = new Set(links.map((l) => l.signalClass))
    return { nodes, links, presentClasses }
  }, [accounts, evidence])

  // Fit the graph to its container once the force simulation settles, so it fills the card instead
  // of sitting as a tight clump wherever the simulation happened to converge.
  const handleEngineStop = useCallback(() => {
    graphRef.current?.zoomToFit(400, 60)
  }, [])

  if (accounts.length === 0) {
    return (
      <div className="text-muted-foreground bg-card flex h-40 items-center justify-center rounded-lg border text-sm">
        No accounts in this cluster to draw.
      </div>
    )
  }

  // A cluster with members but NO labelled links is a real, reportable condition, not an empty
  // decoration. It means the accounts were grouped but the evidence rows behind that grouping were
  // never written - so the graph would render as disconnected dots with no explanation, which is
  // exactly what it did before this check existed. Principle 9 says every connection carries a
  // labelled signal; a graph that silently shows none is hiding a broken pipeline.
  if (links.length === 0) {
    return (
      <div className="bg-card rounded-lg border p-6">
        <p className="text-sm font-medium">This cluster has no recorded evidence links</p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {accounts.length} accounts were grouped together, but no labelled signal rows exist to
          explain why - so there is nothing to draw. That is a data problem, not an empty ring: a
          cluster should never exist without the edges that produced it.
        </p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          It usually means these clusters were written directly into the database rather than by the
          detector, or a detection run failed partway. Re-running detection rebuilds the evidence:
          open the ring queue and use <strong>Run detection</strong>, or{" "}
          <code className="font-mono text-xs">POST /api/clusters/detect</code>.
        </p>
        <ul className="text-muted-foreground mt-3 space-y-1 text-xs">
          {accounts.slice(0, 8).map((a) => (
            <li key={a.id} className="font-mono">
              {a.customerRef} · {a.transactionCount} transactions
            </li>
          ))}
          {accounts.length > 8 && <li>+{accounts.length - 8} more</li>}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="glass-panel border-border/80 relative overflow-hidden rounded-xl border shadow-inner"
        style={{ height }}
      >
        {/* Graph Quick Floating Toolbar */}
        <div className="border-border/60 bg-background/80 absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-lg border p-1 shadow-xs backdrop-blur-md">
          <button
            type="button"
            onClick={() => graphRef.current?.zoom(graphRef.current.zoom() * 1.3, 300)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1 text-xs font-semibold transition-colors"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => graphRef.current?.zoom(graphRef.current.zoom() / 1.3, 300)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1 text-xs font-semibold transition-colors"
            title="Zoom Out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => graphRef.current?.zoomToFit(400, 60)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1.5 py-1 text-[10px] font-medium transition-colors"
            title="Reset View"
          >
            Reset
          </button>
        </div>

        {width > 0 && (
          <ForceGraph2D
            ref={graphRef}
            graphData={{ nodes, links }}
            width={width}
            height={height}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={(n: any) => `${n.fullLabel}: ${n.transactionCount} transactions`}
            linkLabel={(l: any) =>
              `${SIGNAL_LABEL[l.signalType] ?? l.signalType} · ${SIGNAL_CLASS_LABEL[l.signalClass as SignalClass]} · confidence ${(l.confidence * 100).toFixed(0)}%`
            }
            linkColor={(l: any) => l.color}
            linkWidth={(l: any) => l.width}
            linkCurvature={(l: any) => l.curvature}
            linkDirectionalParticles={(l: any) =>
              l.signalClass === "strong_fraud_specific" ? 2 : 0
            }
            linkDirectionalParticleSpeed={0.005}
            linkDirectionalParticleWidth={2}
            cooldownTicks={120}
            onEngineStop={handleEngineStop}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              ctx.beginPath()
              ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI)
              ctx.fillStyle = "hsl(258, 76%, 58%)"
              ctx.fill()
              // A glowing surface ring
              ctx.lineWidth = 1.8 / globalScale
              ctx.strokeStyle = "rgba(255,255,255,0.95)"
              ctx.stroke()

              const fontSize = Math.max(9 / globalScale, 3)
              ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
              ctx.textAlign = "center"
              ctx.textBaseline = "top"
              ctx.fillStyle = "hsl(240, 5%, 65%)"
              ctx.fillText(node.label, node.x, node.y + node.radius + 3 / globalScale)
            }}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.beginPath()
              ctx.arc(node.x, node.y, node.radius + 4, 0, 2 * Math.PI)
              ctx.fillStyle = color
              ctx.fill()
            }}
          />
        )}
      </div>

      <div className="border-border/50 bg-muted/20 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-3.5 py-2 text-xs">
        {LEGEND.filter((l) => presentClasses.has(l.cls)).map(({ cls, note }) => (
          <span key={cls} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block rounded-full shadow-xs"
              style={{
                width: 14,
                height: CLASS_WIDTH[cls] + 1,
                backgroundColor: `hsl(${CLASS_COLOR[cls].h}, ${CLASS_COLOR[cls].s}%, ${CLASS_COLOR[cls].l}%)`,
              }}
            />
            <span className="font-semibold">{SIGNAL_CLASS_LABEL[cls]}</span>
            <span className="text-muted-foreground">: {note}</span>
          </span>
        ))}
        <span className="text-muted-foreground ml-auto">
          Node size = transaction volume · Click/drag nodes to inspect
        </span>
      </div>
    </div>
  )
}
