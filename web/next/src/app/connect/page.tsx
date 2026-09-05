import { RiEyeOffLine, RiLockLine, RiServerLine } from "@remixicon/react"

import { ConnectWorkbench } from "@/components/fraud/connect-workbench"

export const metadata = { title: "Connect your Razorpay account" }
export const dynamic = "force-dynamic"

/**
 * Onboarding.
 *
 * All three routes in converge on the same ingest -> detect pipeline, so there is no second code
 * path that could drift from the one the published metrics were measured on. The page used to
 * argue that at length across four stacked sections; the argument is now one line, and the choice
 * between the three is the page. See connect-workbench.tsx for why the layout works this way.
 */
export default function ConnectPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
        Connect Razorpay. The agent does the rest.
      </h1>
      <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed">
        It pulls your payments, builds the account graph, scores every connected group, and queues
        only the ones worth your attention. Pick a way in.
      </p>

      <div className="mt-8">
        <ConnectWorkbench />
      </div>

      <ul className="text-muted-foreground mt-10 grid gap-4 border-t pt-6 text-sm sm:grid-cols-3">
        <li className="flex items-start gap-2.5">
          <RiEyeOffLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Read-only. The one request it makes is{" "}
            <code className="font-mono text-xs">GET /v1/payments</code>, and it reads five fields
            from it. Never a card number.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <RiLockLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Your secret is encrypted with AES-256-GCM before it reaches the database and is never
            returned by any endpoint.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <RiServerLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Runs in your own infrastructure against your Postgres. Transaction data never has to
            leave it.
          </span>
        </li>
      </ul>
    </main>
  )
}
