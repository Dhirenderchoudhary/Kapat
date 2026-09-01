"use client"

import { RiBankCardLine, RiCheckLine, RiErrorWarningLine } from "@remixicon/react"
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

/**
 * Razorpay Standard Web Checkout.
 *
 * In a fraud-detection product this is a test harness, not a storefront: it exists so you can
 * create a REAL payment and watch the webhook ingest it and the detector score it within seconds.
 * That is the only honest way to demonstrate live detection - a seeded row proves nothing about
 * whether the webhook path works.
 *
 * The key SECRET never appears here. The browser receives only the key id (public - it ships in
 * every Razorpay checkout) and an order id minted server-side. Signature verification is
 * server-side too; this component cannot mark anything as paid.
 */
export function CheckoutButton({ amountPaise = 50000 }: { amountPaise?: number }) {
  const [scriptReady, setScriptReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null)
  const [config, setConfig] = useState<{
    keyId: string | null
    configured: boolean
    mode: string
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

  async function pay() {
    setBusy(true)
    setMessage(null)

    const { data: order, error } = await unwrap(
      apiClient.checkout.order.$post({
        json: { amountPaise, currency: "INR", receipt: `test_${Date.now()}` },
      }),
    )
    if (error || !order) {
      setMessage({ kind: "err", text: error?.message ?? "Could not create the order." })
      setBusy(false)
      return
    }

    const o = order as { orderId: string; amount: number; currency: string; keyId: string }

    if (!window.Razorpay) {
      setMessage({
        kind: "err",
        text: "Razorpay Checkout has not loaded yet. Try again in a moment.",
      })
      setBusy(false)
      return
    }

    const rzp = new window.Razorpay({
      key: o.keyId,
      amount: o.amount,
      currency: o.currency,
      order_id: o.orderId,
      name: "AI Risk Manager",
      description: "Test payment: generates a live event for the detector",
      // Recorded in Razorpay's free-form notes, which is exactly where the detector reads address
      // and promo signals from. Filling them here means a test payment exercises the full signal
      // set rather than only timing.
      notes: { source: "risk-manager-test-checkout" },
      handler: async (response: unknown) => {
        const r = response as {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
        }
        const { error: verifyError } = await unwrap(
          apiClient.checkout.verify.$post({
            json: {
              razorpay_order_id: r.razorpay_order_id,
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_signature: r.razorpay_signature,
            },
          }),
        )
        if (verifyError) {
          setMessage({
            kind: "err",
            text: `Payment completed but the signature did NOT verify: ${verifyError.message}`,
          })
        } else {
          setMessage({
            kind: "ok",
            text: "Payment verified. If your webhook is configured, the detector has already ingested it, check the ring queue.",
          })
        }
        setBusy(false)
      },
      modal: {
        // User closed the modal without paying. Not an error - just release the button.
        ondismiss: () => {
          setMessage({ kind: "info", text: "Checkout closed: no payment was made." })
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

  if (config && !config.configured) {
    return (
      <p className="text-muted-foreground text-sm">
        Checkout is not configured. Set <code className="font-mono text-xs">RAZORPAY_KEY_ID</code>{" "}
        and <code className="font-mono text-xs">RAZORPAY_KEY_SECRET</code> on the API and restart
        it.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={pay} disabled={!scriptReady || busy}>
          <RiBankCardLine className="size-4" aria-hidden />
          {busy ? "Opening Checkout…" : `Make a ₹${(amountPaise / 100).toFixed(0)} test payment`}
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

      <p className="text-muted-foreground text-xs">
        Test card <code className="font-mono">4111 1111 1111 1111</code>, any future expiry, any
        CVV. Test UPI <code className="font-mono">success@razorpay</code>.
      </p>
    </div>
  )
}
