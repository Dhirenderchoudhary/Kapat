"use client"

import {
  RiAlertLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiLoader4Line,
  RiLock2Line,
  RiPlugLine,
  RiRadarLine,
  RiShieldCheckLine,
} from "@remixicon/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, unwrap } from "@/lib/api/client"
import { cn } from "@/lib/utils"

type Status = {
  connected: boolean
  mode: "test" | "live" | null
  keyId: string | null
  lastSyncedAt: string | null
  lastSyncStatus: string | null
}

type SyncResult = {
  paymentsFetched: number
  rowsMapped: number
  accountsCreated: number
  transactionsCreated: number
  clustersDetected: number
  clustersFlagged: number
  signalCoverage: Record<string, number>
}

function explainError(raw: string | undefined): string {
  const message = raw ?? "Request failed"
  if (!/network|fetch|failed to fetch|load failed/i.test(message)) return message
  return "Could not reach the API endpoint. If running via Docker, make sure the API service is active on port 4000."
}

const STEPS = [
  "Verifying credentials & encryption keys",
  "Pulling payment records from Razorpay API",
  "Building signal graph & running Louvain detector",
] as const

export function RazorpayConnect() {
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [keyId, setKeyId] = useState("")
  const [keySecret, setKeySecret] = useState("")
  const [step, setStep] = useState<number>(-1)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await unwrap(apiClient.razorpay.status.$get())
      if (data) setStatus(data as Status)
    })()
  }, [])

  const isLiveKey = keyId.startsWith("rzp_live_")
  const isTestKey = keyId.startsWith("rzp_test_")
  const busy = step >= 0

  async function runSync() {
    setError(null)
    setStep(1)
    const { data, error: err } = await unwrap(apiClient.razorpay.sync.$post())
    if (err) {
      setError(explainError(err.message))
      setStep(-1)
      return
    }
    setStep(2)
    setResult(data as SyncResult)
    setStep(-1)
    const { data: refreshed } = await unwrap(apiClient.razorpay.status.$get())
    if (refreshed) setStatus(refreshed as Status)
    if ((data as SyncResult).clustersFlagged > 0) {
      setTimeout(() => router.push("/clusters"), 1200)
    }
  }

  async function connectAndSync() {
    setError(null)
    setResult(null)

    const trimmedKeyId = keyId.trim()
    const trimmedKeySecret = keySecret.trim()

    if (!trimmedKeyId) {
      setError("Please enter your Razorpay Key ID.")
      return
    }

    if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(trimmedKeyId)) {
      setError(
        "Invalid Key ID format. Razorpay Key IDs start with rzp_test_ (for test mode) or rzp_live_ (for live mode), found in your Razorpay Dashboard under Account & Settings -> API Keys.",
      )
      return
    }

    if (!trimmedKeySecret) {
      setError("Please enter your Razorpay Key Secret.")
      return
    }

    setStep(0)
    const { data, error: err } = await unwrap(
      apiClient.razorpay.connect.$post({
        json: { keyId: trimmedKeyId, keySecret: trimmedKeySecret },
      }),
    )
    if (err) {
      setError(explainError(err.message))
      setStep(-1)
      return
    }
    setStatus(data as Status)
    setKeySecret("")
    await runSync()
  }

  async function disconnect() {
    await unwrap(apiClient.razorpay.connection.$delete())
    setStatus({
      connected: false,
      mode: null,
      keyId: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
    })
    setResult(null)
  }

  if (status?.connected) {
    return (
      <div className="space-y-6">
        <Card className="glass-panel overflow-hidden border-emerald-500/30 shadow-lg">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <RiShieldCheckLine className="size-6" aria-hidden />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-base font-semibold">
                      Razorpay Connected
                    </span>
                    <Badge variant={status.mode === "live" ? "destructive" : "secondary"}>
                      {status.mode === "live" ? "Live Account" : "Test Sandbox"}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-xs">
                    Key: {status.keyId}
                    {status.lastSyncedAt
                      ? ` · Last sync: ${new Date(status.lastSyncedAt).toLocaleString("en-IN")}`
                      : " · Never synced"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <Button onClick={runSync} disabled={busy} className="gap-2 shadow-sm">
                  <RiRadarLine className={cn("size-4", busy && "animate-spin")} aria-hidden />
                  {busy ? "Running Agent…" : "Sync & Scan Now"}
                </Button>
                <Button onClick={disconnect} disabled={busy} variant="outline">
                  Disconnect
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {busy && <ProgressTracker step={step} />}
        {result && <SyncSummary result={result} />}
        {error && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-4 text-sm font-medium">
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="glass-panel border-border shadow-xl">
        <CardHeader className="pb-4">
          <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
            <RiLock2Line className="size-4 text-emerald-500" aria-hidden />
            <span>Secure Credential Vault (AES-256-GCM)</span>
          </div>
          <CardTitle className="text-xl font-bold">Connect Razorpay API</CardTitle>
          <CardDescription className="text-sm">
            Enter your Razorpay server-side API keys. Credentials remain encrypted in your local
            database and are exclusively used for read-only sync of payment transactions.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="keyId" className="text-foreground text-xs font-semibold">
                Key ID
              </label>
              {isLiveKey && (
                <Badge variant="destructive" className="text-[10px]">
                  Live Mode
                </Badge>
              )}
              {isTestKey && (
                <Badge variant="secondary" className="text-[10px]">
                  Test Mode
                </Badge>
              )}
            </div>
            <input
              id="keyId"
              type="text"
              placeholder="rzp_test_... or rzp_live_..."
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              disabled={busy}
              className="bg-background/80 focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-lg border px-3.5 font-mono text-sm shadow-inner transition-colors outline-none focus-visible:ring-2"
            />
            <p className="text-muted-foreground text-xs">
              Found in Razorpay Dashboard -&gt; Account &amp; Settings -&gt; API Keys
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="keySecret" className="text-foreground text-xs font-semibold">
              Key Secret
            </label>
            <input
              id="keySecret"
              type="password"
              placeholder="••••••••••••••••••••••••••••"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              disabled={busy}
              className="bg-background/80 focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-lg border px-3.5 font-mono text-sm shadow-inner transition-colors outline-none focus-visible:ring-2"
            />
            <p className="text-muted-foreground text-xs">
              Encrypted with AES-256-GCM before saving; never exposed over network responses.
            </p>
          </div>

          {isLiveKey && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300">
              <RiAlertLine className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Live Mode API key detected. The agent only executes read requests (GET /v1/payments)
                and will never modify, capture, or refund live payments.
              </span>
            </div>
          )}

          <Button
            onClick={connectAndSync}
            disabled={busy || !keyId || !keySecret}
            size="lg"
            className="w-full gap-2 shadow-md"
          >
            {busy ? (
              <>
                <RiLoader4Line className="size-4 animate-spin" aria-hidden />
                <span>Connecting &amp; Analyzing...</span>
              </>
            ) : (
              <>
                <RiPlugLine className="size-4" aria-hidden />
                <span>Connect &amp; Run Detector</span>
              </>
            )}
          </Button>

          {busy && <ProgressTracker step={step} />}

          {error && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3.5 text-xs font-medium">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProgressTracker({ step }: { step: number }) {
  return (
    <div className="bg-muted/30 space-y-3 rounded-xl border p-4">
      <div className="text-foreground text-xs font-semibold">Pipeline Execution Progress</div>
      <div className="space-y-2">
        {STEPS.map((label, idx) => {
          const isDone = step > idx
          const isCurrent = step === idx
          return (
            <div key={label} className="flex items-center gap-3 text-xs">
              <div
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  isDone && "bg-emerald-500 text-white",
                  isCurrent && "bg-primary text-primary-foreground animate-pulse",
                  !isDone && !isCurrent && "bg-muted text-muted-foreground border",
                )}
              >
                {isDone ? <RiCheckLine className="size-3.5" /> : idx + 1}
              </div>
              <span
                className={cn(
                  isCurrent && "font-semibold text-foreground",
                  !isCurrent && "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SyncSummary({ result }: { result: SyncResult }) {
  return (
    <Card className="glass-panel border-emerald-500/30 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-xs font-medium tracking-wider text-emerald-600 uppercase dark:text-emerald-400">
          <RiCheckDoubleLine className="size-4" aria-hidden />
          <span>Sync &amp; Detection Complete</span>
        </div>
        <CardTitle className="text-lg font-bold">Analysis Results</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="bg-card/60 rounded-lg border p-3">
            <div className="text-muted-foreground text-[11px]">Payments Ingested</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{result.paymentsFetched}</div>
          </div>
          <div className="bg-card/60 rounded-lg border p-3">
            <div className="text-muted-foreground text-[11px]">Accounts Mapped</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{result.accountsCreated}</div>
          </div>
          <div className="bg-card/60 rounded-lg border p-3">
            <div className="text-muted-foreground text-[11px]">Candidate Rings</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{result.clustersDetected}</div>
          </div>
          <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3">
            <div className="text-destructive text-[11px] font-semibold">Flagged Fraud Rings</div>
            <div className="text-destructive mt-1 text-xl font-bold tabular-nums">
              {result.clustersFlagged}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
