# Design

The dashboard is the product. Screens match `web/next/src/app` and `web/next/src/components/fraud/console-nav.tsx`.

## Console

Ordered as the work is done: overview, queue, holds, then the pages that show how the detector reached a verdict.

### Overview (`/`)

Hero numbers from the shipped scorer's held-out row. Charts from `data/*.json`. Voice studio on this page: play a Sarvam line, speak a reply, see the parse. The studio does not capture or cancel.

### Queue (`/clusters`)

One row per open cluster, risk descending: flagged at, account count, risk, exposure, verification status, link to detail.

### Ring detail (`/clusters/[id]`)

1. **Network graph.** Accounts as nodes, shared signals as edges. Hover shows `signal_type` and confidence. No unlabeled edge.
2. **Evidence.** Sentences a merchant can read: "4 accounts share a delivery address." Direct translation of `account_links`, not a separate model.
3. **Decide.** Exposure, transcript if any, Freeze / Block / Escalate / Dismiss. Dismiss requires a reason (database CHECK, not only UI).

There is no `/accounts/:id` page in this build. Account facts live on the cluster detail.

### Holds (`/holds`)

Payments in `authorized` that the agent did not capture. Countdown from `expires_at`. Release captures. Reject refunds. Both require a named person.

### Analysis (`/analysis`)

Live counts from `GET /api/analytics`. If a percentage would rest on a tiny denominator, the raw counts travel with it.

### Evidence (`/evidence`)

Everything the repo has measured, including adversarial failures. Same JSON as `GET /api/evidence`.

### Accuracy (`/metrics`)

Offline held-out numbers next to live funnel counts. The API keeps those two families in separate fields so a dashboard cannot present a research score as today's production precision.

### Connect (`/connect`)

Merchant Razorpay key id and secret. Secret stored AES-256-GCM. Without `RAZORPAY_CREDENTIAL_KEY` the API refuses to store a credential.

## Evidence colours

One palette in `web/next/src/app/globals.css`. The colour that classifies a signal is the colour the UI uses.

| Token               | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `--evidence-benign` | Household-plausible (address, card)                         |
| `--evidence-weak`   | Weakly fraud-specific (coordinated timing)                  |
| `--evidence-strong` | No ordinary household explanation (promo funnel, SIM block) |
| `--primary`         | Ultramarine. Links, focus, primary actions                  |

Crimson (`--evidence-strong`) is for strong fraud evidence and a flagged state. Not headings, not decorative buttons. Green is not the brand accent: on a risk queue green means cleared.

`ChartPalette` in `components/fraud/charts.tsx` aliases the same tokens. Colour is never the only carrier: every chart has a text label or legend.

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
