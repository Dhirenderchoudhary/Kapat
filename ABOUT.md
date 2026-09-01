# About AI Risk Manager

## The Problem: Coordinated Fraud Rings

Traditional payment fraud solutions look at transactions **one at a time**. If a transaction is under ₹5,000, has a valid card, and uses a legitimate promo code, traditional rules approve it.

However, organized fraud rings exploit this exact blindspot:

- A fraudster creates **10 to 50 fake accounts**.
- Each account places one modest order using a high-value welcome discount or promo code.
- Orders are placed within minutes of each other.
- Weeks later, all transactions result in chargebacks, leaving the merchant with substantial financial losses.

If a merchant creates naive rules to catch them (e.g., "block any shared address or Wi-Fi"), they trigger **mass false positives**:

- Families sharing an apartment or home address get blocked.
- College roommates sharing a Wi-Fi network get blocked.
- Legitimate customers churn, hurting conversion and brand trust.

---

## The Solution: Corroboration Graph Intelligence

**AI Risk Manager** introduces a graph corroboration architecture that distinguishes organized fraud rings from innocent households with mathematical precision.

```
       [ Razorpay Transactions / Webhooks ]
                        │
                        ▼
           [ Entity Resolution & Graph ]
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
  [ Innocent Household ]        [ Fraud Ring ]
  - Shared Address only         - Sequential Phone Numbers
  - Shared Wi-Fi only           - Device Fingerprint overlap
  - Varied cards / timing       - Coordinated velocity
         │                             │
         ▼                             ▼
    [ Approved ]               [ Corroboration Engine ]
                                       │
                                       ▼
                         [ Multilingual Voice AI Call ]
                         - English / Hindi / Marathi
                         - "Did you authorize this transaction?"
                                       │
                                       ▼
                           [ Merchant Review & Hold ]
```

---

## 3 Core Pillars

### 1. Corroboration, Not Accumulation

Naive graph scoring adds up edge density and average confidence. If three flatmates live at the same address, a naive graph sees 3 connections and flags them as a "dense fraud cluster".

Our corroboration engine recognizes that shared address is only **one fact in evidence**. A cluster is only flagged when **independent, fraud-specific signals** corroborate each other (e.g., matching device fingerprint + sequential phone numbers + coordinated order velocity).

### 2. Autonomous Multilingual Voice AI Verification

When a borderline cluster is detected, an autonomous AI voice verification agent calls the customer in their preferred language (**English, Hindi, or Marathi**).

- **Legitimate Customer**: Confirms knowledge of the account and purchase. Risk score decreases.
- **Fraudster / Fake Account**: Denies knowing the linked account or fails to respond. Fraud hypothesis is confirmed.

### 3. Human-in-the-Loop Safeguards

The AI Risk Manager calculates risk scores and prepares evidence dossiers, but **never acts destructively on its own**. Merchant operators retain final control with clear, one-click actions:

- **Place 24-Hour Settlement Hold**: Temporarily holds payouts via Razorpay API to prevent chargebacks before goods ship.
- **Release Hold**: Instantly releases funds if verified legitimate.
- **Refund & Block**: Issues a clean refund before costly chargeback fees hit.

---

## Target Audience

- **E-Commerce & D2C Brands**: Stop welcome coupon abuse and coordinated inventory draining.
- **Digital Goods & Gaming**: Prevent virtual currency theft across disposable accounts.
- **Fintech & Lending Apps**: Detect synthetic identity rings before disbursement.
