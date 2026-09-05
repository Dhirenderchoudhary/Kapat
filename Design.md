# Design

The dashboard is the product. Screens match `web/next/src/app` and `web/next/src/components/fraud/console-nav.tsx`.

## Console

Ordered as the work is done: overview, queue, holds, then the pages that show how the detector reached a verdict.

### Overview (`/`)

Hero numbers from the shipped scorer's held-out row. Charts from `data/*.json`. Voice studio on this page: play a Sarvam line, speak a reply, see the parse. The studio does not capture or cancel.

### Queue (`/clusters`)

One row per open cluster: flagged at, account count, risk, the signals linking the group (strongest first, coloured by evidence class), exposure, verification status, link to detail.

The chips are `account_links` reduced to distinct signal types (`signalTypes` on the list endpoint, the same edges the detail page renders). Filters and sortable columns run in the browser over rows already fetched. A filter matching nothing is hidden rather than shown disabled.

The three counts above the table (open, critical, exposure) are a divided row, not three tinted cards. The colour budget on this screen belongs to the evidence.

### Ring detail (`/clusters/[id]`)

The verdict leads. Before any of the sections below, one sentence answers why this is marked as fraud. Then the two or three signals that carried the score, each with a plain line on why it counts, and a line naming what was discounted because a family would share it too.

`components/fraud/cluster-verdict.ts` derives that from the same evidence rows and the same stored detector record the rest of the page renders, never as a second opinion. The detector's own audit lines stay verbatim, collapsed under "Detector audit trail".

Then, in this order:

1. **Network graph.** Accounts as nodes, shared signals as edges. Hover shows `signal_type` and confidence. No unlabeled edge.
2. **Evidence.** Sentences a merchant can read: "4 accounts share a delivery address." Direct translation of `account_links`, not a separate model.
3. **Decide.** Exposure, transcript if any, Freeze / Block / Escalate / Dismiss. Dismiss requires a reason (database CHECK, not only UI).

There is no `/accounts/:id` page in this build. Account facts live on the cluster detail.

### Holds (`/holds`)

Payments in `authorized` that the agent did not capture. Countdown from `expires_at`. Release captures. Reject refunds. Both require a named person.

The note field is the merchant's own note, not the detector reason already printed above it. A refund is refused without one. The name field error says what to do (`hold.nameRequired`), in all four languages.

### Analysis (`/analysis`)

Live counts from `GET /api/analytics`. If a percentage would rest on a tiny denominator, the raw counts travel with it.

### Evidence (`/evidence`)

Everything the repo has measured, including adversarial failures. Same JSON as `GET /api/evidence`.

### Accuracy (`/metrics`)

Offline held-out numbers next to live funnel counts. The API keeps those two families in separate fields so a dashboard cannot present a research score as today's production precision.

### Connect (`/connect`)

Three ways in (live Razorpay keys, a CSV export, the sample dataset) are one choice on one screen. Picking one collapses the row into a rail and gives the width to the thing being done. The other two stay one click away.

Merchant Razorpay key id and secret. Secret stored AES-256-GCM. Without `RAZORPAY_CREDENTIAL_KEY` the API refuses to store a credential.

## Evidence colours

One palette in `web/next/src/app/globals.css`. The colour that classifies a signal is the colour the UI uses.

| Token               | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `--evidence-benign` | Household-plausible (address, card)                         |
| `--evidence-weak`   | Weakly fraud-specific (coordinated timing)                  |
| `--evidence-strong` | No ordinary household explanation (promo funnel, SIM block) |
| `--primary`         | Ultramarine. Links, focus, primary actions                  |

Badges read the same tokens. `SIGNAL_CLASS_STYLE` and `RISK_BAND_STYLE` in `signal-taxonomy.ts` use `--evidence-*`, so a badge and a chart of the same class are the same colour. Hero graph edges carry their own class colour. No traffic-light dots in the preview chrome, and no pulse on every holds row.

Crimson (`--evidence-strong`) is for strong fraud evidence and a flagged state. Not headings, not decorative buttons. Green is not the brand accent: on a risk queue green means cleared.

`ChartPalette` in `components/fraud/charts.tsx` aliases the same tokens. Colour is never the only carrier: every chart has a text label or legend.

## Navigation

Live data pages are `force-dynamic` and read a separate API deployment, so a navigation costs a real server round trip. The interface still has to paint on click.

The landing page and `/connect` are prerendered. The landing page reads the committed evaluation reports during the build, without querying the live metrics funnel. Report changes invalidate the Turbo build cache through `data/*.json`; rebuild the web app to publish new numbers. The global demo banner reads `hasData` from `/api/razorpay/status`, which checks for one transaction instead of fetching the entire analytics dashboard. Live decisions and payment data still use fresh API reads. See [performance notes](docs/performance.md).

1. **A `loading.tsx` on every route.** Without one, Next renders nothing until the server render finishes. `components/shell/page-skeleton.tsx` holds the pieces, shaped like the page they stand in for.
2. **Those same files are what prefetch can fetch.** A `<Link>` to a dynamic route has nothing to prefetch unless the route has a loading boundary.
3. **`experimental.staleTimes` in `next.config.ts`.** The default of 0 for dynamic routes means the back button re-fetches everything. Every mutation calls `router.refresh()` first, so a decision or an import is never read back from a stale entry.

`components/common/route-progress.tsx` puts a bar at the top of the window and a spinner on the control that was clicked, using `useLinkStatus`, so it is only on screen while a navigation is in flight.

On narrow screens the hero uses a shrinkable single-column grid and wraps its preview controls. Grouped model bars keep labels aligned in a keyboard-focusable horizontal scroll region instead of widening the whole page. CSS-only report charts render on the server with their existing animations and reduced-motion support.

## Graph

- Node size follows transaction volume
- Edge thickness follows confidence
- Hover is required, not ornamental

## Voice

Languages: `en-IN`, `hi-IN`, `mr-IN`. Native script for Hindi and Marathi (romanized lines degrade Bulbul).

Merchant opening (English), from `api/hono/src/lib/voice-scripts.ts`:

> Hello, this is Razorpay Risk Manager. We held a payment because it looks like coordinated fraud, not a normal transaction. Should we cancel this payment, or release the hold?

The agent records cancel / release / unclear. A human still confirms in the dashboard.

Customer outcomes on the ring question:

| Outcome            | Meaning                                       |
| ------------------ | --------------------------------------------- |
| `confirmed_linked` | Aware of the other account. Often household   |
| `denied_linked`    | No knowledge. Strengthens the ring hypothesis |
| `unclear`          | No confident span                             |
| `no_response`      | Unreachable                                   |

That mapping is the inverse of a single-payment "did you buy this" verifier. Get it the wrong way round and the dashboard labels lie.

## What this build does not include

No merchant login as a product surface (Better Auth exists on the API; the fraud console is usable without it for the demo). No mobile-first polish pass. No Twilio/Exotel in the critical path. Simulated or Sarvam-in-process voice first.
