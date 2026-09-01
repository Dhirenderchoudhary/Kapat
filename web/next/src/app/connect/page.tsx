import { RiCheckLine, RiEyeOffLine, RiLockLine, RiShieldCheckLine } from "@remixicon/react"
import Link from "next/link"

import { CheckoutButton } from "@/components/fraud/checkout-button"
import { CsvImport } from "@/components/fraud/csv-import"
import { LoadDemoData } from "@/components/fraud/load-demo-data"
import { RazorpayConnect } from "@/components/fraud/razorpay-connect"
import { Section } from "@/components/marketing/sections"

export const metadata = { title: "Connect your Razorpay account" }
export const dynamic = "force-dynamic"

/**
 * Onboarding, in the order a merchant should actually try things.
 *
 * The live Razorpay connection leads, because it is the real product: connect once, and the agent
 * pulls payments and runs detection with nobody exporting anything. CSV import stays as the path
 * for merchants who won't hand over API keys to an unfamiliar tool, or who want to analyse a
 * historical export. The sample dataset is for evaluating the detector before trusting it with real
 * customers.
 *
 * All three converge on the same ingest -> detect pipeline. There is no second, divergent code path
 * that could drift from the one the published metrics were measured on.
 */
export default function ConnectPage() {
  return (
    <main>
      <section className="border-b">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Connect Razorpay. The agent does the rest.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-lg leading-relaxed">
            Paste your API keys once. The agent pulls your payments, builds the account graph,
            scores every connected group, and puts only the ones worth your attention in a queue. No
            export, no spreadsheet, no terminal.
          </p>
        </div>
      </section>

      <Section
        eyebrow="Recommended"
        title="Connect your Razorpay account"
        lead="Read-only. The client issues exactly one kind of request: GET /v1/payments. There is no code path in this system that could capture, refund or reverse anything."
      >
        <RazorpayConnect />

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-5">
            <RiLockLine className="text-muted-foreground size-5" aria-hidden />
            <h3 className="mt-3 text-sm font-medium">Your secret is encrypted at rest</h3>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              AES-256-GCM before it reaches the database, and never returned by any endpoint again.
              If the server has no encryption key configured, connecting is refused rather than
              storing it in the clear.
            </p>
          </div>
          <div className="rounded-lg border p-5">
            <RiEyeOffLine className="text-muted-foreground size-5" aria-hidden />
            <h3 className="mt-3 text-sm font-medium">It reads five fields</h3>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              Contact, payment-instrument id, amount, timestamp, and whatever you record in{" "}
              <code className="font-mono text-xs">notes</code>. Never a card number, never a
              credential, never your payout settings.
            </p>
          </div>
          <div className="rounded-lg border p-5">
            <RiShieldCheckLine className="text-muted-foreground size-5" aria-hidden />
            <h3 className="mt-3 text-sm font-medium">Runs in your own infrastructure</h3>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              The whole stack is containerised and talks to your Postgres. Your transaction data
              never has to leave your environment.
            </p>
          </div>
        </div>

        <div className="bg-muted/40 mt-4 rounded-lg border p-5">
          <h3 className="text-sm font-medium">One thing to know before the first run</h3>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            This integration is built against Razorpay&apos;s published Fetch All Payments contract,
            but it has not yet completed a round trip against the live API, as every environment
            this was developed in blocks outbound calls to Razorpay. The mapping and pagination are
            written to spec and unit-testable, and your first sync is the real test. If it fails,
            that is integration work to finish, not a broken detector: the detection pipeline behind
            it is the same one the published accuracy numbers were measured on.
          </p>
        </div>
      </Section>

      <Section
        eyebrow="Prove it works"
        title="Make a real test payment and watch it get detected"
        lead="The honest way to verify live detection: create an actual payment through Razorpay Checkout. Razorpay posts the event to your webhook, the agent ingests it and re-scores the graph, and it appears in the ring queue within seconds. No seeding, no simulation."
      >
        <CheckoutButton />
        <div className="bg-muted/40 mt-5 rounded-lg border p-5">
          <h3 className="text-sm font-medium">Point the webhook at this deployment first</h3>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            In the Razorpay Dashboard: <strong>Settings → Webhooks → Add New Webhook</strong>. URL
            is <code className="font-mono text-xs">https://your-host/webhooks/razorpay</code>,
            subscribe to <code className="font-mono text-xs">payment.captured</code> and{" "}
            <code className="font-mono text-xs">payment.authorized</code>, and set a secret. Put
            that same secret in <code className="font-mono text-xs">RAZORPAY_WEBHOOK_SECRET</code>.
            Running locally, expose port 4000 with a tunnel so Razorpay can reach it.
          </p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Without that secret the webhook endpoint returns 503 and refuses the request: it will
            not accept unverified payloads, because an unauthenticated write into the fraud graph
            would let anyone poison your detection with fabricated accounts.
          </p>
        </div>
      </Section>

      <Section
        eyebrow="Alternative"
        title="Upload a CSV instead"
        lead="If you would rather not hand API keys to a tool you have just met, a completely reasonable position for a risk product, export your transactions and upload the file. Same detector, same pipeline, on demand instead of continuously."
      >
        <CsvImport />
        <p className="text-muted-foreground mt-5 flex items-start gap-2 text-sm">
          <RiShieldCheckLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Parsed in your browser. Only the columns you explicitly map are sent anywhere.
          </span>
        </p>
      </Section>

      <Section
        eyebrow="Try it first"
        title="See it run on sample data"
        lead="396 accounts and 949 transactions containing real coordinated rings, legitimate households deliberately built to look like rings, and ordinary traffic. Nothing in it is a real person."
      >
        <LoadDemoData />
        <p className="text-muted-foreground mt-4 text-sm">
          Watch for the thing that actually matters: the households stay out of the queue even
          though they are densely connected.{" "}
          <Link href="/metrics" className="underline underline-offset-4">
            Measured accuracy is here.
          </Link>{" "}
          <span className="inline-flex items-center gap-1">
            <RiCheckLine className="size-3.5" aria-hidden />
            Including the cases it gets wrong.
          </span>
        </p>
      </Section>
    </main>
  )
}
