# DESIGN - AI Risk Manager: Fraud Ring Detection Platform

The dashboard is the product. This document is weighted accordingly.

---

## 1. Dashboard views

### 1.1 Rings Overview (`/clusters`)

A table, one row per open cluster, sorted by risk score descending by default:

| Column            | Content                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| Risk score        | 0-1, with its band named in words                                          |
| Accounts involved | count                                                                      |
| Why it is flagged | the signals linking the group, coloured by evidence class, strongest first |
| ₹ exposure        | chargeback_exposure figure                                                 |
| Review            | status, with the voice-check outcome beneath it                            |
| Detected          | date                                                                       |
| ->                | link to detail                                                             |

**The row has to say why.** Without the signals column every row carries a score, a count, a rupee
figure and two status words, which is the same shape for every row: fifteen open groups looked
identical and a reviewer opened all of them to find out which was actually a ring. The chips are
`account_links` reduced to its distinct signal types (`signalTypes` on the list endpoint, the same
edges the detail page renders), coloured by the taxonomy in §1a, with the strong ones first.

Above the table are the filters someone actually asks for out loud - what is worst, what has
evidence no household produces, what is still on me, what is already done - and the sortable
columns. Both run in the browser over rows already fetched: these routes are `force-dynamic`
against a separate API, and a server round trip to hide four rows is not a trade worth making. A
filter matching nothing is hidden rather than shown disabled.

The three counts above that (open, critical, exposure) are set as a divided row, not as three
tinted cards. They were three panels with three different border colours, three icons in three
tinted squares, and one of them spent a red on a total that carries no alarm. Three numbers of one
kind read as one measurement taken three ways; boxes read as three separate things. The colour
budget on this screen belongs to the evidence.

### 1.2 Ring Detail (`/clusters/:id`) - the core screen

**The verdict leads.** Before any of the sections below, one sentence answers the only question
someone arrives with: why is this marked as fraud. "6 accounts are linked by phone numbers from one
sequential block. No ordinary household produces that." Then the two or three signals that carried
the score, each with a plain line on why it counts, and a line naming what was discounted because a
family would share it too.

`components/fraud/cluster-verdict.ts` derives that from the same evidence rows and the same stored
detector record the rest of the page renders, never as a second opinion. The detector's own audit
lines are still there verbatim, collapsed under "Detector audit trail": they are the record, and a
reviewer months later needs them, but they name the taxonomy and restate the threshold, and reading
them first is what made this page unreadable to a first-time viewer.

Then, in this order:

1. **Network graph** (`react-force-graph-2d`) - accounts as nodes, edges as the shared signals connecting them. Node color = individual account risk contribution. Edge labeled on hover with the exact `signal_type` and confidence (Rules.md Principle 9 - never an unlabeled line). Clicking a node opens the account drill-down.
2. **Evidence panel** - plain-language list: _"4 accounts share the same delivery address," "3 accounts used the same promo code within 6 minutes of each other," "2 accounts share a payment method fingerprint."_ This is a direct translation of the graph into sentences a merchant can read in five seconds - don't make them infer it from the graph alone.
3. **Decide** - ₹ exposure figure, verification status/transcript if triggered, four buttons: Freeze / Block / Escalate / Dismiss. Dismiss opens a required reason field (Rules.md Principle 10) - not a free-text box, a short set of options (e.g., "legitimate shared household," "coincidental overlap," "other" with text).

### 1.2a Onboarding (`/connect`)

Three ways in - live Razorpay keys, a CSV export, the sample dataset - are one choice on one
screen, not four stacked full-height sections. Presented as separate sections, nobody discovered
the second and third without scrolling past the first. Picking one collapses the row into a rail
and gives the width to the thing being done; the other two stay one click away, because people
routinely try the sample data first and connect afterwards.

### 1.3 Account drill-down (`/accounts/:id`)

Transaction history, which clusters this account has appeared in (past and present), verification history if any.

### 1.3a Held payments (`/holds`)

The one screen where a click moves money, so its copy has to be exact. Two things were not.

The note field on each hold was a bare placeholder reading "Why it was held" - which is the
detector's reason, already printed directly above it - when it is the merchant's own note, and a
refund is refused without one. It carries a label and says which of the two actions needs it.

And the guard on the "your name" field surfaced the field's own label as the error, so pressing
Release with no name printed the words "Your name" in red and left the merchant to work out what
that meant. Errors here say what to do (`hold.nameRequired`), in all four languages.

### 1.4 Metrics view

Precision/recall on the held-out set, false-positive cost (with the specific legitimate-look-alike cases that were wrongly/rightly handled), verifier accuracy, funnel counts (clusters flagged -> verified -> merchant decision breakdown). This is the screen the demo lingers on.

---

## 1a. The evidence palette

One colour system, defined once in `web/next/src/app/globals.css`. The colour that classifies
evidence and the colour that paints the interface are the same colour, because on this product they
mean the same thing.

| Token               | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `--evidence-benign` | a signal an ordinary household also produces (address, card) |
| `--evidence-weak`   | weakly fraud-specific (coordinated timing)                   |
| `--evidence-strong` | no ordinary household explanation (promo funnel, SIM block)  |
| `--primary`         | ultramarine. Links, focus, primary actions                   |

Two rules hold this together:

**Crimson is rationed.** `--evidence-strong` appears for strong fraud-specific evidence and for a
flagged state, and nowhere else. Never on a heading, a button, or as decoration. On a screen where
someone decides whether to hold a customer's money, the one red thing should always mean the same
thing.

**Green is not the accent.** In a risk queue green means "cleared", so it cannot also be the brand.
The accent used to be `emerald-*`, hardcoded in 106 places across 16 files; the scale is now
remapped to the ultramarine accent in the theme layer rather than rewritten at every call site. New
code uses `primary` or the evidence tokens directly. See the comment in `globals.css`.

Charts read the same tokens: `ChartPalette` in `components/fraud/charts.tsx` aliases
`--chart-benign/-weak/-strong` onto them, so a signal class is the same colour in a chart, on a
badge, and on a graph edge. It used to be six hex values redeclared per page, which meant a theme
change moved the interface and left the evidence colours behind.

Badges read them too. `SIGNAL_CLASS_STYLE` and `RISK_BAND_STYLE` in `signal-taxonomy.ts` were
written against Tailwind's `red-500` and `amber-500`, so a "Strong fraud signal" badge and the
strong-signal colour in a chart were two different reds on the same screen. They read
`--evidence-*` now, which also retires the `dark:` variant on every badge: the token flips per
theme, so one class covers both. The hero's own graph had the same fault in its worst form - five
edges hardcoded to one rose hex, saying a shared card is as damning as a sequential SIM block,
which is the opposite of what this product argues. Each edge carries the colour of its own class.

Two ornaments were spending the rationed colour on nothing: three macOS traffic-light dots in the
hero preview's chrome, one of them red, and a pulsing dot on every row of `/holds`. On a list where
every row pulses, none of them stands out.

Colour is never the sole carrier of meaning: every chart also carries a text label or a legend
naming each class in words (see the accessibility note at the top of `charts.tsx`).

---

## 1b. Navigating between pages

Live data pages are `force-dynamic` and read a separate API deployment, so a navigation costs a
real server round trip: about 1.5s warm, and over 5s on a cold API. That is worth fixing at the
source, but it is not a reason for the interface to look broken while it happens, and it did. A
reviewer clicking Inspect thought the page had frozen, and said the same of the back button.

The landing page and `/connect` are now prerendered. The landing page reads the committed
evaluation reports during the build, without querying the live metrics funnel. Report changes
invalidate the Turbo build cache through `data/*.json`; rebuild the web app to publish new numbers.
The global demo banner reads `hasData` from `/api/razorpay/status`, which checks for one transaction
instead of fetching the entire analytics dashboard. Live decisions and payment data still use
fresh API reads and the existing mutation refresh behavior. See [performance notes](docs/performance.md).

Three things, in the order they matter:

1. **A `loading.tsx` on every route.** Without one, Next renders nothing at all until the server
   render finishes; with one, the click paints a skeleton immediately. `components/shell/page-skeleton.tsx`
   holds the pieces. The skeletons are shaped like the page they stand in for, because a skeleton
   whose blocks land where the content lands reads as the page arriving, and one that does not
   reads as a second screen flashing past.
2. **Those same files are what prefetch can fetch.** A `<Link>` to a dynamic route has nothing to
   prefetch unless the route has a loading boundary, so this is also what makes the queue's Inspect
   links warm before they are clicked.
3. **`experimental.staleTimes` in `next.config.ts`.** The default of 0 for dynamic routes means the
   back button re-fetches everything. With it set, back is served from the router cache and costs
   no server request at all. Every mutation calls `router.refresh()` first, which drops the whole
   cache, so a decision or an import is never read back from a stale entry.

On top of that, `components/common/route-progress.tsx` puts a bar at the top of the window and a
spinner on the control that was clicked, for the moment between the click and the skeleton. It uses
`useLinkStatus`, so it is only ever on screen while a navigation is genuinely in flight.

On narrow screens the hero uses a shrinkable single-column grid and wraps its preview controls.
Grouped model bars keep labels aligned in a keyboard-focusable horizontal scroll region instead
of widening the whole page. CSS-only report charts render on the server with their existing
animations and reduced-motion support.

---

## 2. Graph visualization design specifics

- Node size proportional to account transaction volume - visually distinguishes a high-volume account from a peripheral one in the same cluster
- Edge thickness proportional to confidence - a thin line for a weak signal, thick for strong
- Color, not just position, distinguishes risk tiers - don't rely on layout alone to communicate severity
- Hover tooltips are mandatory, not decorative - Principle 9 is enforced here specifically

---

## 3. Voice conversation design (ring-verification context)

### Script structure

1. Identify - who's calling and why
2. State the finding - "your account shares [signal] with another account"
3. Ask - are you aware of this, is it someone you know (family/roommate) or not
4. Listen, one clarifying re-ask maximum if unclear
5. Close - tell them what happens next

### Sample - Hindi (hi-IN)

> "Namaste, main Razorpay ki taraf se baat kar raha hoon. Humne dekha ki aapka account ek doosre account ke saath same [address/payment method] share karta hai. Kya aap is doosre account ke baare mein jaante hain - kya yeh aapke parivar ka koi sadasya hai?"

### Sample - English (en-IN)

> "Hi, this is an automated call from Razorpay. We noticed your account shares the same [address/payment method] with another account. Are you aware of this other account - is it a family member or someone you know?"

### Sample - Marathi (mr-IN)

> "Namaskar, hi Razorpay kadun call ahe. Tumcha account ek dusrya account sobat [address/payment method] share karto ase amhala disla. Tumhala ha dusra account mahit ahe ka - to tumcha kutumbiya ahe ka?"

_(Same note as before - have a fluent speaker sanity-check phrasing before recording.)_

### response_parser outcomes

| Outcome            | Meaning                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `confirmed_linked` | Account holder confirms awareness - likely legitimate (family/shared household)             |
| `denied_linked`    | Account holder denies any knowledge of the linked account - strengthens the ring hypothesis |
| `unclear`          | Ambiguous, one clarifying re-ask exhausted                                                  |
| `no_response`      | Unreachable                                                                                 |

Note this is the inverse of what might feel intuitive: a _confirmed_ link often points _toward_ legitimacy here, while a _denied_ link strengthens suspicion - opposite of the earlier single-transaction verifier design where "confirmed" meant the transaction was legitimate. Get this the right way round in `response_parser.py` and in the dashboard's status labels - it's an easy place to introduce a silent logic bug.

---

## 4. What NOT to design

Same as before: no merchant auth/login flows, no mobile-responsive polish, no landing page, no animated transitions. Every hour here is an hour not spent on Phase 8 (Phases.md), where your actual differentiation and your genuine "what broke" story both live.
