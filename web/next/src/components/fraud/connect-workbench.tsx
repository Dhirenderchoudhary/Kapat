"use client"

import {
  RiArrowRightLine,
  RiDatabase2Line,
  RiPlugLine,
  RiUploadCloud2Line,
  type RemixiconComponentType,
} from "@remixicon/react"
import Link from "next/link"
import { useState } from "react"

import { CheckoutButton } from "@/components/fraud/checkout-button"
import { CsvImport } from "@/components/fraud/csv-import"
import { LoadDemoData } from "@/components/fraud/load-demo-data"
import { RazorpayConnect } from "@/components/fraud/razorpay-connect"
import { cn } from "@/lib/utils"

/**
 * The three ways in, on one screen.
 *
 * This page used to be four full-height marketing sections stacked vertically, which meant a
 * merchant who landed on it saw the Razorpay form and had no idea CSV import or the sample dataset
 * existed until they scrolled past it. The options are a choice, so they are presented as a
 * choice: three cards, side by side, above the fold.
 *
 * Picking one collapses the row into a rail and gives the rest of the width to the thing being
 * done, which is the only part that needs room. The other two stay visible as a rail rather than
 * disappearing, because changing your mind here is common: people try the sample data first and
 * connect afterwards.
 */

type Choice = "razorpay" | "csv" | "sample"

const CHOICES: {
  key: Choice
  icon: RemixiconComponentType
  title: string
  blurb: string
  tag?: string
}[] = [
  {
    key: "razorpay",
    icon: RiPlugLine,
    title: "Connect Razorpay",
    blurb: "Read-only keys. Your payments sync and get scanned continuously.",
    tag: "Recommended",
  },
  {
    key: "csv",
    icon: RiUploadCloud2Line,
    title: "Upload a CSV",
    blurb: "Any export works. Parsed in your browser, only mapped columns leave it.",
  },
  {
    key: "sample",
    icon: RiDatabase2Line,
    title: "Load sample data",
    blurb: "396 accounts: real rings, plus households built to look like rings.",
  },
]

export function ConnectWorkbench() {
  const [choice, setChoice] = useState<Choice | null>(null)

  if (choice === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChoice(c.key)}
            className="hover:border-primary/50 hover:bg-card focus-visible:ring-ring group rounded-xl border p-5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <div className="flex items-center justify-between">
              <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                <c.icon className="size-5" aria-hidden />
              </span>
              {c.tag && (
                <span className="text-primary bg-primary/5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase">
                  {c.tag}
                </span>
              )}
            </div>
            <h3 className="text-foreground mt-3 text-base font-semibold">{c.title}</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{c.blurb}</p>
            <span className="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium">
              Start
              <RiArrowRightLine
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-10">
      <div className="space-y-2 lg:col-span-3">
        {CHOICES.map((c) => {
          const active = c.key === choice
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChoice(c.key)}
              aria-pressed={active}
              className={cn(
                "focus-visible:ring-ring flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
                active
                  ? "border-primary/50 bg-primary/5"
                  : "hover:bg-muted/50 border-border/80 bg-card/40",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                <c.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {c.title}
                </span>
                {active && (
                  <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                    {c.blurb}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="lg:col-span-7">
        {choice === "razorpay" && <RazorpayPanel />}
        {choice === "csv" && <CsvPanel />}
        {choice === "sample" && <SamplePanel />}
      </div>
    </div>
  )
}

function RazorpayPanel() {
  return (
    <div className="space-y-4">
      <RazorpayConnect />

      {/* Both of these used to be full sections of their own. They are real caveats and they stay,
          but they are things you read once, when you hit them: closed by default. */}
      <details className="group border-border/80 bg-card/40 rounded-xl border">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none p-4 text-sm font-medium select-none">
          Before your first sync
          <span className="float-right text-xs group-open:hidden">Show</span>
          <span className="float-right hidden text-xs group-open:inline">Hide</span>
        </summary>
        <p className="text-muted-foreground px-4 pb-4 text-sm leading-relaxed">
          This integration is written to Razorpay&apos;s published Fetch All Payments contract, but
          has not yet made a live round trip: every environment it was built in blocks outbound
          calls to Razorpay. Your first sync is the real test. If it fails, that is integration work
          to finish, not a broken detector.
        </p>
      </details>

      <details className="group border-border/80 bg-card/40 rounded-xl border">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none p-4 text-sm font-medium select-none">
          Prove it with a real payment
          <span className="float-right text-xs group-open:hidden">Show</span>
          <span className="float-right hidden text-xs group-open:inline">Hide</span>
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Point a webhook at this deployment first: Razorpay Dashboard, Settings, Webhooks. URL{" "}
            <code className="font-mono text-xs">https://your-host/webhooks/razorpay</code>,
            subscribe to <code className="font-mono text-xs">payment.captured</code> and{" "}
            <code className="font-mono text-xs">payment.authorized</code>, and put the secret in{" "}
            <code className="font-mono text-xs">RAZORPAY_WEBHOOK_SECRET</code>. Without it the
            endpoint returns 503 rather than accept an unverified write into your fraud graph.
          </p>
          <CheckoutButton />
        </div>
      </details>
    </div>
  )
}

function CsvPanel() {
  return (
    <div className="space-y-4">
      <CsvImport />
      <p className="text-muted-foreground text-sm">
        Same detector, same pipeline as the live connection: on demand instead of continuously.
      </p>
    </div>
  )
}

function SamplePanel() {
  return (
    <div className="space-y-4 rounded-xl border p-6">
      <h3 className="text-foreground text-base font-semibold">See it run on sample data</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">
        396 accounts and 949 transactions: real coordinated rings, legitimate households built to
        look like rings, and ordinary traffic. Nothing in it is a real person. Watch the households
        stay out of the queue even though they are densely connected.
      </p>
      <LoadDemoData />
      <p className="text-muted-foreground text-sm">
        <Link href="/metrics" className="underline underline-offset-4">
          Measured accuracy
        </Link>
        , including the cases it gets wrong.
      </p>
    </div>
  )
}
