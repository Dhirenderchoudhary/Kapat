"use client"

import { RiCheckLine, RiErrorWarningLine, RiRepeatLine } from "@remixicon/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void
      on: (e: string, cb: (r: unknown) => void) => void
    }
  }
}

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js"

const FEATURES = [
  "Ring detection and the review queue",
  "Payment holds, release and reject",
  "Voice verification in three languages",
  "Live Razorpay sync, CSV import, sample data",
  "Evidence, metrics and analysis",
]

/**
 * Razorpay Subscriptions checkout for the single Kapat plan: ₹500 / month, every feature.
 * The key SECRET never appears here. The browser gets the public key id and a subscription id.
 */
export function SubscribeButton() {
  const [scriptReady, setScriptReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null)
  const [config, setConfig] = useState<{
    configured: boolean
    mode: string
    subscription: { amountPaise: number; period: string }
  } | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await unwrap(apiClient.checkout.config.$get())
      if (data) setConfig(data as never)
    })()

    if (document.querySelector(`script[src="${CHECKOUT_SCRIPT}"]`)) {
      setScriptReady(true)
      return
    }
    const script = document.createElement("script")
    script.src = CHECKOUT_SCRIPT
    script.async = true
    script.onload = () => setScriptReady(true)
    script.onerror = () =>
      setMessage({
        kind: "err",
        text: "Could not load Razorpay Checkout. Check your network or ad blocker.",
      })
    document.body.appendChild(script)
  }, [])

  async function subscribe() {
    setBusy(true)
    setMessage(null)

    const { data, error } = await unwrap(apiClient.checkout.subscription.$post())
    if (error || !data) {
      setMessage({ kind: "err", text: error?.message ?? "Could not create the subscription." })
      setBusy(false)
      return
    }

    const s = data as { subscriptionId: string; amount: number; currency: string; keyId: string }

    if (!window.Razorpay) {
      setMessage({
        kind: "err",
        text: "Razorpay Checkout has not loaded yet. Try again in a moment.",
      })
      setBusy(false)
      return
    }

    const rzp = new window.Razorpay({
      key: s.keyId,
      subscription_id: s.subscriptionId,
      name: "Kapat",
      description: "₹500 / month · all features",
      handler: async (response: unknown) => {
        const r = response as {
          razorpay_payment_id: string
          razorpay_subscription_id: string
          razorpay_signature: string
        }
        const { error: verifyError } = await unwrap(
          apiClient.checkout.subscription.verify.$post({
            json: {
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_subscription_id: r.razorpay_subscription_id,
              razorpay_signature: r.razorpay_signature,
            },
          }),
        )
        if (verifyError) {
          setMessage({
            kind: "err",
            text: `Paid, but the signature did NOT verify: ${verifyError.message}`,
          })
        } else {
          setMessage({
            kind: "ok",
            text: "Subscription started. Every feature on this console is included.",
          })
        }
        setBusy(false)
      },
      modal: {
        ondismiss: () => {
          setMessage({ kind: "info", text: "Checkout closed: no subscription was started." })
          setBusy(false)
        },
      },
      theme: { color: "#5b21b6" },
    })

    rzp.on("payment.failed", (resp: unknown) => {
      const r = resp as { error?: { description?: string; reason?: string } }
      setMessage({
        kind: "err",
        text: `Payment failed: ${r.error?.description ?? r.error?.reason ?? "unknown reason"}`,
      })
      setBusy(false)
    })

    rzp.open()
  }

  const rupees = ((config?.subscription.amountPaise ?? 50_000) / 100).toFixed(0)

  if (config && !config.configured) {
    return (
      <p className="text-muted-foreground text-sm">
        Subscriptions need <code className="font-mono text-xs">RAZORPAY_KEY_ID</code> and{" "}
        <code className="font-mono text-xs">RAZORPAY_KEY_SECRET</code> on the API.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <ul className="text-muted-foreground space-y-1.5 text-sm">
        {FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <RiCheckLine className="text-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={subscribe} disabled={!scriptReady || busy}>
          <RiRepeatLine className="size-4" aria-hidden />
          {busy ? "Opening Checkout…" : `Subscribe · ₹${rupees} / month`}
        </Button>
        {config?.mode === "test" && (
          <span className="text-muted-foreground rounded-full border px-2.5 py-1 text-xs">
            Test mode: no real money moves
          </span>
        )}
      </div>

      {message && (
        <p
          className={
            message.kind === "err"
              ? "text-destructive flex items-start gap-2 text-sm"
              : message.kind === "ok"
                ? "flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground flex items-start gap-2 text-sm"
          }
        >
          {message.kind === "ok" ? (
            <RiCheckLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : message.kind === "err" ? (
            <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : null}
          <span>{message.text}</span>
        </p>
      )}
    </div>
  )
}
