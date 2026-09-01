# DESIGN - AI Risk Manager: Fraud Ring Detection Platform

The dashboard is the product. This document is weighted accordingly.

---

## 1. Dashboard views

### 1.1 Rings Overview (`/clusters`)

A table, one row per open cluster, sorted by risk score descending by default:

| Column              | Content                                                             |
| ------------------- | ------------------------------------------------------------------- |
| Flagged at          | timestamp                                                           |
| Accounts involved   | count                                                               |
| Risk score          | 0-1, colored band                                                   |
| ₹ exposure          | chargeback_exposure figure                                          |
| Verification status | verified-linked / verified-legitimate / unclear / not yet triggered |
| ->                  | link to detail                                                      |

### 1.2 Ring Detail (`/clusters/:id`) - the core screen

Three sections, in this order:

1. **Network graph** (`react-force-graph-2d`) - accounts as nodes, edges as the shared signals connecting them. Node color = individual account risk contribution. Edge labeled on hover with the exact `signal_type` and confidence (Rules.md Principle 9 - never an unlabeled line). Clicking a node opens the account drill-down.
2. **Evidence panel** - plain-language list: _"4 accounts share the same delivery address," "3 accounts used the same promo code within 6 minutes of each other," "2 accounts share a payment method fingerprint."_ This is a direct translation of the graph into sentences a merchant can read in five seconds - don't make them infer it from the graph alone.
3. **Decide** - ₹ exposure figure, verification status/transcript if triggered, four buttons: Freeze / Block / Escalate / Dismiss. Dismiss opens a required reason field (Rules.md Principle 10) - not a free-text box, a short set of options (e.g., "legitimate shared household," "coincidental overlap," "other" with text).

### 1.3 Account drill-down (`/accounts/:id`)

Transaction history, which clusters this account has appeared in (past and present), verification history if any.

### 1.4 Metrics view

Precision/recall on the held-out set, false-positive cost (with the specific legitimate-look-alike cases that were wrongly/rightly handled), verifier accuracy, funnel counts (clusters flagged -> verified -> merchant decision breakdown). This is the screen the demo lingers on.

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
