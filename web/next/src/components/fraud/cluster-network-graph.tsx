"use client"

import { useMemo, useState } from "react"

import { ChartPalette } from "@/components/fraud/charts"
import {
  SIGNAL_CLASS_LABEL,
  SIGNAL_LABEL,
  signalClassOf,
  type SignalClass,
} from "@/components/fraud/signal-taxonomy"

/**
 * The ring graph: a deterministic radial layout, drawn as inline SVG.
 *
 * WHY THIS REPLACED A FORCE SIMULATION
 * ====================================
 * This used to be react-force-graph-2d on a canvas. For the size of graph this product actually
 * shows - a detected ring is 2 to about 12 accounts - a force simulation is the wrong tool, and it
 * failed in a specific, visible way: three nodes converged into a tight clump in one corner of a
 * 420px canvas, ~85% of the box was empty, `zoomToFit` could not rescue it because the simulation
 * had already collapsed the layout, and node positions changed on every render so the same ring
 * never looked the same twice.
 *
 * A ring has no meaningful spatial structure to discover. Nobody needs to learn that account A is
 * "near" account B; they need to read WHICH SIGNALS connect WHICH ACCOUNTS. So the layout is fixed
 * by construction - members evenly spaced on a circle - and every pixel of design effort goes into
 * the edges, which are the actual evidence.
 *
 * WHAT THE PICTURE ENCODES
 * ========================
 *   edge colour     signal class: red = no household does this, amber = some do, slate = routine
 *   edge width      the same ordinal scale, so class survives greyscale and colour-blindness
 *   edge opacity    confidence in that individual signal
 *   parallel arcs   one arc per signal between a pair, never merged - the whole product promise is
 *                   that every connection is individually labelled and auditable
 *   node size       transaction volume, normalised so one heavy account cannot dwarf the rest
 *   node ring       highlighted on hover along with everything it touches
 *
 * Colour is never the only carrier: there is a legend, every edge names its signal in the hover
 * panel, and width tracks class independently.
 *
 * Deterministic on purpose. The same cluster produces a byte-identical picture every time, which
 * matters for a screen a merchant may screenshot and attach to a dispute.
 */

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

const CLASS_STROKE: Record<SignalClass, string> = {
  strong_fraud_specific: "var(--chart-strong)",
  weak_fraud_specific: "var(--chart-weak)",
  benign_explainable: "var(--chart-benign)",
}

const CLASS_WIDTH: Record<SignalClass, number> = {
  strong_fraud_specific: 2.6,
  weak_fraud_specific: 1.9,
  benign_explainable: 1.2,
}

/** Drawn last, so the evidence that decides the verdict sits on top of the routine stuff. */
const CLASS_ORDER: Record<SignalClass, number> = {
  benign_explainable: 0,
  weak_fraud_specific: 1,
  strong_fraud_specific: 2,
}

const W = 760
const H = 460
const CX = W / 2
const CY = H / 2

export function ClusterNetworkGraph({
  accounts,
  evidence,
}: {
  accounts: GraphAccount[]
  evidence: GraphEvidence[]
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [focusEdge, setFocusEdge] = useState<string | null>(null)

  const { nodes, edges, presentClasses } = useMemo(() => {
    const n = accounts.length
    const maxTxns = Math.max(1, ...accounts.map((a) => a.transactionCount))

    // Leave room for the labels that sit outside the ring, so a long customer ref never collides
    // with the edge of the viewBox. Small clusters get a tighter circle so three nodes do not
    // float absurdly far apart.
    const radius = n <= 2 ? 120 : n <= 4 ? 150 : n <= 8 ? 168 : 182

    const nodes = accounts.map((a, i) => {
      // Start at the top and go clockwise. -90deg so a 2-node cluster reads vertically rather
      // than as a horizontal pair that looks like an arrow.
      const angle = (-90 + (360 / n) * i) * (Math.PI / 180)
      return {
        ...a,
        x: CX + Math.cos(angle) * radius,
        y: CY + Math.sin(angle) * radius,
        angle,
        r: 16 + (a.transactionCount / maxTxns) * 12,
        short: a.customerRef.replace(/^cust_/, ""),
      }
    })

    const pos = new Map(nodes.map((node) => [node.id, node]))

    // One arc per signal. Several signals between the same pair fan out with alternating
    // curvature so each stays separately visible and hoverable.
    const seen = new Map<string, number>()
    const edges = evidence
      .map((e) => {
        const a = pos.get(e.accountA)
        const b = pos.get(e.accountB)
        if (!a || !b) return null
        const key = [e.accountA, e.accountB].sort().join("::")
        const i = seen.get(key) ?? 0
        seen.set(key, i + 1)

        // Perpendicular offset from the straight line, alternating sides.
        const bow = i === 0 ? 0 : Math.ceil(i / 2) * 26 * (i % 2 === 0 ? -1 : 1)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const ctrlX = mx + (-dy / len) * bow
        const ctrlY = my + (dx / len) * bow

        const cls = signalClassOf(e.signalType)
        return {
          id: e.id,
          from: e.accountA,
          to: e.accountB,
          cls,
          signalType: e.signalType,
          confidence: e.confidence,
          d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
          labelX: ctrlX,
          labelY: ctrlY,
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((p, q) => CLASS_ORDER[p.cls] - CLASS_ORDER[q.cls])

    return { nodes, edges, presentClasses: new Set(edges.map((e) => e.cls)) }
  }, [accounts, evidence])

  if (accounts.length === 0) {
    return (
      <div className="text-muted-foreground bg-card flex h-40 items-center justify-center rounded-lg border text-sm">
        No accounts in this cluster to draw.
      </div>
    )
  }

  // A cluster with members but no labelled links is a real, reportable condition, not an empty
  // decoration: it means the accounts were grouped but the evidence rows behind that grouping were
  // never written. Saying so beats drawing disconnected dots.
  if (edges.length === 0) {
    return (
      <div className="bg-card rounded-lg border p-6">
        <p className="text-sm font-medium">This cluster has no recorded evidence links</p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {accounts.length} accounts were grouped together, but no labelled signal rows exist to
          explain why. That is a data problem, not an empty ring: a cluster should never exist
          without the edges that produced it. Re-run detection from the ring queue to rebuild them.
        </p>
      </div>
    )
  }

  const active = focusEdge ? edges.find((e) => e.id === focusEdge) : null
  const dimmed = (edgeFrom: string, edgeTo: string) =>
    hovered !== null && hovered !== edgeFrom && hovered !== edgeTo

  return (
    <div className="space-y-3">
      {/* The palette must travel WITH this component, not be assumed from the page.
          Every edge colour here is a --chart-* variable, and those are declared by ChartPalette.
          The evidence and overview pages happen to render it; the cluster detail page did not, so
          every stroke resolved to nothing and the graph drew three labelled nodes joined by
          absolutely nothing - a fraud ring rendered as three unrelated dots, on the one screen
          whose entire job is showing the connections. Rendering it here makes the component
          self-sufficient; a second copy on a page that already has one is a duplicate <style> with
          identical declarations, which is harmless. */}
      <ChartPalette />
      <div className="bg-card/40 relative overflow-hidden rounded-xl border">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`${accounts.length} linked accounts connected by ${edges.length} labelled signals`}
        >
          <defs>
            {/* A faint glow behind the strongest evidence, so a ring reads as a ring at a glance. */}
            <radialGradient id="ring-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--chart-strong)" stopOpacity="0.10" />
              <stop offset="100%" stopColor="var(--chart-strong)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {presentClasses.has("strong_fraud_specific") && (
            <circle cx={CX} cy={CY} r={190} fill="url(#ring-core)" />
          )}

          {edges.map((e) => {
            const isDim = dimmed(e.from, e.to)
            return (
              <path
                key={e.id}
                d={e.d}
                fill="none"
                stroke={CLASS_STROKE[e.cls]}
                strokeWidth={CLASS_WIDTH[e.cls]}
                strokeLinecap="round"
                opacity={isDim ? 0.08 : 0.3 + e.confidence * 0.6}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => setFocusEdge(e.id)}
                onMouseLeave={() => setFocusEdge(null)}
              >
                <title>
                  {SIGNAL_LABEL[e.signalType] ?? e.signalType} ({SIGNAL_CLASS_LABEL[e.cls]}) ·
                  confidence {e.confidence.toFixed(2)}
                </title>
              </path>
            )
          })}

          {nodes.map((node) => {
            const isDim = hovered !== null && hovered !== node.id
            // Push the label outward along the same spoke the node sits on, so labels radiate and
            // never overlap each other or the arcs in the middle.
            const lx = CX + Math.cos(node.angle) * (node.r + 168)
            const ly = CY + Math.sin(node.angle) * (node.r + 148)
            const anchor = Math.abs(lx - CX) < 30 ? "middle" : lx > CX ? "start" : "end"
            return (
              <g
                key={node.id}
                opacity={isDim ? 0.35 : 1}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r + 5}
                  fill="none"
                  stroke="var(--chart-strong)"
                  strokeWidth={2}
                  opacity={hovered === node.id ? 0.8 : 0}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  className="fill-background stroke-border"
                  strokeWidth={1.5}
                />
                <text
                  x={node.x}
                  y={node.y + 4}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={13}
                  fontWeight={600}
                >
                  {node.transactionCount}
                </text>
                <text
                  x={lx}
                  y={ly}
                  textAnchor={anchor}
                  className="fill-muted-foreground"
                  fontSize={11.5}
                  fontFamily="ui-monospace, monospace"
                >
                  {node.short}
                </text>
                <title>
                  {node.customerRef} · {node.transactionCount} transactions
                </title>
              </g>
            )
          })}
        </svg>

        {/* Reads out whatever edge the pointer is on. A tooltip that names the signal in words is
            what stops colour from being the only thing carrying meaning. */}
        <div className="border-border/60 bg-background/90 absolute bottom-3 left-3 rounded-lg border px-3 py-2 text-xs backdrop-blur-sm">
          {active ? (
            <>
              <span className="text-foreground font-medium">
                {SIGNAL_LABEL[active.signalType] ?? active.signalType}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {SIGNAL_CLASS_LABEL[active.cls]} · confidence {active.confidence.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {accounts.length} accounts · {edges.length} labelled signals · hover an edge
            </span>
          )}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {(
          [
            ["strong_fraud_specific", "No ordinary household does this"],
            ["weak_fraud_specific", "Households sometimes do this"],
            ["benign_explainable", "Families and flatmates do this routinely"],
          ] as const
        )
          .filter(([cls]) => presentClasses.has(cls))
          .map(([cls, note]) => (
            <li key={cls} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="h-[3px] w-5 shrink-0 rounded-full"
                style={{ backgroundColor: CLASS_STROKE[cls] }}
              />
              <span className="text-foreground font-medium">{SIGNAL_CLASS_LABEL[cls]}</span>
              <span className="text-muted-foreground">{note}</span>
            </li>
          ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        The number inside each account is its transaction count, and the circle is sized by it. Each
        line is one signal: several between the same pair are drawn as separate arcs, never merged.
      </p>
    </div>
  )
}
