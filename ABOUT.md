# About

## Problem

Per-transaction fraud rules miss coordinated rings. Ten accounts, each placing one modest order with a welcome promo, all look fine alone. Weeks later they charge back together.

Naive graph rules ("block any shared address") hit families, flatmates, and office deliveries. That is a false-positive product, not a detector.

## Product

AI Risk Manager builds a graph of **labeled** account-to-account signals, clusters with Louvain, and scores **how many independent kinds of evidence** exist. A shared address is one fact, not a dense fraud clique. A sequential SIM block or a funnelled promo is the kind of fact a household does not produce.

Borderline groups can be asked, in English, Hindi, or Marathi, whether they know the linked account. Confirming the link often means family. Denying it supports the ring hypothesis. The parser is rules, not an LLM, and it is allowed to say unclear.

Nothing in the agent captures or cancels a payment. The lever is declining to capture (Razorpay manual capture). A merchant releases the hold to settle, or rejects it to refund. A forgotten hold expires in the customer's favour.

## Who it is for

D2C and e-commerce teams losing welcome-coupon inventory to multi-account abuse. Digital goods and gaming where disposable accounts drain value. Anyone whose current tool scores one `payment.captured` at a time.

## What the numbers mean

Held-out and adversarial figures in the README are synthetic, regenerated from scripts in this repo. They test that the implementation does what it claims. They do not claim calibrated rupee savings on live Razorpay traffic.
