"use client"

import { RiDatabase2Line } from "@remixicon/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

/** One-click evaluation path: load the bundled synthetic dataset and run the detector, with no
 *  terminal. Both calls are idempotent, so clicking twice is harmless. */
export function LoadDemoData() {
  const router = useRouter()
  const [stage, setStage] = useState<"idle" | "loading" | "detecting">("idle")
  const [error, setError] = useState<string | null>(null)

  async function run() {
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
    router.push("/clusters")
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={stage !== "idle"} size="lg">
        <RiDatabase2Line className="size-4" aria-hidden />
        {stage === "idle" && "Load demo data and scan"}
        {stage === "loading" && "Loading 396 accounts…"}
        {stage === "detecting" && "Running the detector…"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}
