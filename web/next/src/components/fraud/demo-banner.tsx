"use client"

import { RiFlaskLine, RiLoader4Line } from "@remixicon/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

/**
 * Shown on every merchant-facing screen while no Razorpay account is connected.
 *
 * The alternative - an empty dashboard - is the worst possible first impression for a fraud
 * product: a merchant sees zeroes and cannot tell whether the agent works, is broken, or simply has
 * nothing to look at. So an unconnected instance says exactly what it is, and offers one click to
 * fill itself with a synthetic dataset that contains real rings, real look-alike households, and
 * ordinary traffic - enough to watch the detector make every kind of decision it can make.
 *
 * It also refuses to be subtle about the data being synthetic. A demo that quietly looks like
 * production is how someone ends up quoting a demo number in a real conversation.
 */
export function DemoBanner() {
  const router = useRouter()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [hasData, setHasData] = useState<boolean | null>(null)
  const [stage, setStage] = useState<"idle" | "loading" | "detecting">("idle")
  const [error, setError] = useState<string | null>(null)
  const [apiDown, setApiDown] = useState(false)
  const [dbNotReady, setDbNotReady] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const statusRes = await unwrap(
        apiClient.razorpay.status.$get({}, { init: { signal: controller.signal } }),
      )
      if (controller.signal.aborted) return

      // If the API itself is unreachable, say so once, here, instead of letting every screen show
      // its own bare "Network request failed". The overwhelmingly common cause in development is
      // that the web app is running but the API server is not - `bun run dev` starts both, a lone
      // `next dev` does not.
      if (statusRes.error?.code === "NETWORK_ERROR") {
        setApiDown(true)
        setConnected(false)
        setHasData(false)
        return
      }

      // A REACHABLE API whose queries fail is a different fault with a different fix, and telling
      // someone to restart the API when the real problem is an unmigrated database sends them off
      // for an hour. The signature is a 500 whose message comes from the query layer: the table
      // does not exist yet because `bun run db:migrate` has not been run against this Postgres.
      const queryFailed = (e: { code?: string; message?: string } | null | undefined) =>
        e?.code === "INTERNAL_SERVER_ERROR" &&
        /failed query|does not exist|relation .* does not exist/i.test(e.message ?? "")

      if (queryFailed(statusRes.error)) {
        setDbNotReady(true)
        setConnected(false)
        setHasData(false)
        return
      }

      setConnected(Boolean(statusRes.data?.connected))
      setHasData(Boolean(statusRes.data?.hasData))
    })()
    return () => controller.abort()
  }, [])

  async function loadDemo() {
    setError(null)
    setStage("loading")
    const { error: ingestErr } = await unwrap(apiClient.ingest.demo.$post())
    if (ingestErr) {
      setError(ingestErr.message)
      setStage("idle")
      return
    }
    setStage("detecting")
    const { error: detectErr } = await unwrap(apiClient.clusters.detect.$post({ json: {} }))
    if (detectErr) {
      setError(detectErr.message)
      setStage("idle")
      return
    }
    setStage("idle")
    setHasData(true)
    router.refresh()
  }

  // The API being unreachable outranks everything else on this bar: nothing on any screen can
  // work, and every other message would be a guess about data we cannot read.
  if (apiDown) {
    return (
      <div className="bg-destructive/5 border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-2.5 sm:px-6">
          <p className="text-sm">
            {/* Was `red-500`/`red-700`, a fourth red on a product that defines exactly one.
                --destructive is the token, and it already resolves to the evidence crimson. */}
            <span className="text-destructive font-medium">The API is not reachable.</span>{" "}
            <span className="text-muted-foreground">
              Every screen will be empty until it is running. In development start both together
              with <code className="font-mono text-xs">bun run dev</code> from the repo root
              (running only the web app leaves the API down), or with Docker use{" "}
              <code className="font-mono text-xs">docker compose up --build -d</code>. If the API is
              running on a different host or port, set{" "}
              <code className="font-mono text-xs">NEXT_PUBLIC_API_URL</code> to match.
            </span>
          </p>
        </div>
      </div>
    )
  }

  // Same precedence logic as apiDown: nothing on any screen can work, so this outranks the
  // synthetic-data invitation below.
  if (dbNotReady) {
    return (
      <div className="border-b bg-amber-500/5">
        <div className="mx-auto w-full max-w-6xl px-4 py-2.5 sm:px-6">
          <p className="text-sm">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              The API is running, but its database has no tables yet.
            </span>{" "}
            <span className="text-muted-foreground">
              Apply the migrations with{" "}
              <code className="font-mono text-xs">bun run db:migrate</code> from the repo root, then
              reload. If that fails to connect, start Postgres first:{" "}
              <code className="font-mono text-xs">docker compose up -d postgres</code>.
            </span>
          </p>
        </div>
      </div>
    )
  }

  // Connected accounts get nothing - their data is real and the banner would be noise.
  if (connected !== false) return null

  return (
    <div className="border-b bg-amber-500/5">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
        <RiFlaskLine className="size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <p className="text-sm">
          <span className="font-medium">Demo mode: synthetic data.</span>{" "}
          <span className="text-muted-foreground">
            {hasData
              ? "No Razorpay account is connected, so everything here comes from a generated dataset. No figure on these screens describes real traffic."
              : "Nothing is loaded yet. Load the sample dataset to watch the detector work before connecting anything."}
          </span>
        </p>

        <div className="ml-auto flex items-center gap-2">
          {!hasData && (
            <Button size="sm" onClick={loadDemo} disabled={stage !== "idle"}>
              {stage !== "idle" && <RiLoader4Line className="size-4 animate-spin" aria-hidden />}
              {stage === "idle" && "Load sample data"}
              {stage === "loading" && "Loading…"}
              {stage === "detecting" && "Detecting…"}
            </Button>
          )}
          <Button render={<Link href="/connect" />} size="sm" variant="outline">
            Connect Razorpay
          </Button>
        </div>

        {error && <p className="text-destructive w-full text-xs">{error}</p>}
      </div>
    </div>
  )
}
