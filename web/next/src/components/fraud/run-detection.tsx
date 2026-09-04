"use client"

import { RiRadarLine } from "@remixicon/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

type DetectSummary = {
  accountsConsidered: number
  transactionsConsidered: number
  clustersDetected: number
  clustersFlagged: number
  clustersNewlyPersisted: number
  accountLinksNewlyPersisted: number
}

/**
 * Triggers the detector agent (POST /api/clusters/detect -> detector-service /detect-rings) and
 * reports what it actually did.
 *
 * Principle 1 is why this is a button and not a background job that fires on ingestion:
 * detection is an explicit act with a visible result, and even then all it does is put clusters in
 * front of a human. Nothing here freezes, blocks, or moves money - only a merchant_decisions row
 * does that, and only a person can create one.
 */
export function RunDetection() {
  const router = useRouter()
  const [state, setState] = useState<"idle" | "running">("idle")
  const [summary, setSummary] = useState<DetectSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setState("running")
    setError(null)
    setSummary(null)
    const { data, error: err } = await unwrap(apiClient.clusters.detect.$post({ json: {} }))
    if (err) {
      setError(err.message)
    } else if (data) {
      setSummary(data as DetectSummary)
      router.refresh()
    }
    setState("idle")
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={run} disabled={state === "running"} size="sm">
        <RiRadarLine className="size-4" aria-hidden />
        {state === "running" ? "Scanning…" : "Run detection"}
      </Button>

      {summary && (
        <p className="text-muted-foreground max-w-md text-right text-xs">
          Scanned {summary.accountsConsidered.toLocaleString("en-IN")} accounts and{" "}
          {summary.transactionsConsidered.toLocaleString("en-IN")} transactions. Found{" "}
          {summary.clustersDetected} connected groups, flagged {summary.clustersFlagged} as rings
          {summary.clustersDetected > summary.clustersFlagged && (
            <>
              {" "}
              and held back {summary.clustersDetected - summary.clustersFlagged} with an ordinary
              household explanation
            </>
          )}
          . {summary.clustersNewlyPersisted} new to this queue.
        </p>
      )}
      {error && (
        <p className="text-destructive max-w-md text-right text-xs">Detection failed: {error}</p>
      )}
    </div>
  )
}
