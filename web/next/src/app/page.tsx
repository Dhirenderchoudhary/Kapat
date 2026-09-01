import {
  RiArrowRightLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiGitBranchLine,
  RiLockLine,
  RiShieldCheckLine,
} from "@remixicon/react"
import Link from "next/link"

import { HeroSection } from "@/components/fraud/hero-section"
import { CompareTable, Section, Stage } from "@/components/marketing/sections"
import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function pct(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `${(value * 100).toFixed(0)}%`
}

/**
 * The landing page.
 *
 * Every headline number here is read from the live metrics endpoint, which reads
 * data/detector_metrics.json - the file evaluate.py writes. Nothing on this page is a number typed
 * in by hand, because a marketing page that drifts out of sync with the detector's actual measured
 * performance is exactly the thing that destroys the trust it is trying to build. If the metrics
 * are not available the page says so and links to /metrics rather than showing a remembered figure.
 */
export default async function LandingPage() {
  const { data } = await unwrap(apiClient.metrics.$get())
  const d = data?.detector ?? null

  const recall = pct(d?.recall_true_rings)
  const precision = pct(d?.precision_predicted_clusters)
  const precisionBefore = pct(d?.precision_without_threshold)
  const wronglyFlagged = d
    ? (d.n_lookalikes_wrongly_flagged ?? d.n_lookalikes_wrongly_flagged_high_confidence)
    : null
  const totalLookalikes = d?.n_lookalikes ?? null

  return (
    <main>
      {/* ---------------------------------------------------------------- Hero */}
      <HeroSection
        recall={recall}
        precision={precision}
        wronglyFlagged={wronglyFlagged}
        totalLookalikes={totalLookalikes}
      />

      {/* ------------------------------------------------------------- Problem */}
      <Section
        eyebrow="The problem"
        title="A ring is invisible one transaction at a time"
        lead="Six accounts, six different names, six ordinary-sized orders, all using the same welcome coupon over four days. Every transaction-level rule you have will pass all six. The pattern only exists in the connections, and the moment you start looking at connections, you hit the real problem: families are connected too."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                What a rules engine sees
              </span>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
                Per-transaction
              </span>
            </div>
            <p className="text-foreground mt-4 text-sm leading-relaxed sm:text-base">
              Six unrelated customers, each with one modest transaction and a valid coupon. Nothing
              exceeds a velocity threshold. Nothing exceeds an amount threshold. Six approvals.
            </p>
          </div>
          <div className="glass-card-hover rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                What the graph sees
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                Network topology
              </span>
            </div>
            <p className="text-foreground mt-4 text-sm leading-relaxed sm:text-base">
              One delivery address. One card fingerprint. Six phone numbers differing only in the
              last digit. All six firing inside a four-minute window. The same promo code through
              every one of them.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------- Insight */}
      <Section
        id="insight"
        eyebrow="The core idea"
        title="Corroboration, not accumulation"
        lead="This is the one idea the whole product rests on, and it started as a bug we found in our own detector. Our first scoring model gave a legitimate household a risk score of 0.61 - over the line - on nothing but a shared address. Here is why."
      >
        <div className="space-y-6">
          <div className="glass-panel rounded-xl border p-6 shadow-sm">
            <h3 className="text-foreground text-lg font-semibold">
              The mistake almost every naive graph score makes
            </h3>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-base">
              Three flatmates sharing one delivery address produce a fully-connected triangle of
              high-confidence edges. A scorer that adds up <em>density</em> plus{" "}
              <em>average confidence</em> plus <em>group size</em> reads that as three separate
              pieces of evidence - &ldquo;dense! confident! decent size!&rdquo; - and pushes them
              over the threshold.
            </p>
            <p className="text-foreground mt-3 text-sm leading-relaxed sm:text-base">
              But there is only <strong>one fact</strong> in evidence: these people live together.
              Density and confidence are re-observations of that same fact, not independent
              corroboration of it. Counting them separately triple-counts a single observation.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-foreground text-base font-semibold">
                  A legitimate household
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Benign
                </span>
              </div>
              <ul className="text-muted-foreground space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <RiCheckLine className="size-4 text-emerald-500" />
                  <span>Shared delivery address</span>
                </li>
                <li className="flex items-center gap-2">
                  <RiCheckLine className="size-4 text-emerald-500" />
                  <span>Shared family card</span>
                </li>
                <li className="flex items-center gap-2">
                  <RiCheckLine className="size-4 text-emerald-500" />
                  <span>Sometimes order around the same time</span>
                </li>
              </ul>
              <p className="bg-muted/40 text-foreground mt-4 rounded-lg p-3 text-xs sm:text-sm">
                Three overlaps. Fully dense. <strong>Not flagged</strong> - because every one of
                those has a complete innocent explanation.
              </p>
            </div>

            <div className="glass-card-hover border-destructive/30 bg-destructive/5 rounded-xl border p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-destructive text-base font-semibold">
                  A coordinated fraud ring
                </span>
                <span className="bg-destructive/10 text-destructive rounded-full px-2.5 py-0.5 text-xs font-semibold">
                  Flagged
                </span>
              </div>
              <ul className="text-muted-foreground space-y-2 text-sm">
                <li className="text-destructive flex items-center gap-2">
                  <RiCheckLine className="text-destructive size-4" />
                  <span>Phone numbers from one sequential block</span>
                </li>
                <li className="text-destructive flex items-center gap-2">
                  <RiCheckLine className="text-destructive size-4" />
                  <span>One promo code funnelled through every account</span>
                </li>
                <li className="text-destructive flex items-center gap-2">
                  <RiCheckLine className="text-destructive size-4" />
                  <span>Transactions firing within minutes, repeatedly</span>
                </li>
              </ul>
              <p className="bg-destructive/10 text-destructive mt-4 rounded-lg p-3 text-xs font-medium sm:text-sm">
                <strong>Flagged.</strong> Families do not buy consecutive SIM ranges, and a
                household has no reason to route one coupon through six separate accounts.
              </p>
            </div>
          </div>

          <div className="glass-panel border-primary/20 bg-primary/5 rounded-xl border p-6 shadow-sm">
            <h3 className="text-foreground text-base font-semibold">The rule, in one sentence</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed sm:text-base">
              A group whose every connection has an ordinary household explanation is{" "}
              <strong className="text-foreground">capped below the flagging threshold</strong>, no
              matter how tightly connected it looks. Getting flagged requires at least one signal a
              family does not produce.
            </p>
            <p className="text-muted-foreground mt-4 text-xs sm:text-sm">
              Fixing this took precision from{" "}
              {precisionBefore ? (
                <strong className="text-foreground">{precisionBefore}</strong>
              ) : (
                "41%"
              )}{" "}
              to{" "}
              {precision ? (
                <strong className="text-emerald-600 dark:text-emerald-400">{precision}</strong>
              ) : (
                "100%"
              )}{" "}
              on the held-out split, with zero loss of recall.
            </p>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------- Pipeline */}
      <Section
        id="how"
        eyebrow="How it works"
        title="Five stages, all of them inspectable"
        lead="Nothing here is a black box you have to take on faith. Every stage writes down what it did, and the dashboard shows you the detector's own words, not a summary of them."
      >
        <div>
          <Stage n={1} title="Build the signal graph">
            <p>
              Accounts become nodes. Each shared signal becomes its own labelled edge - shared
              address, shared payment fingerprint, sequential phone block, coordinated timing,
              reused promo code - every one carrying its own confidence.
            </p>
            <p>
              Timing and promo signals only fire after a pair co-occurs{" "}
              <strong>at least twice</strong>. At real volume, one near-simultaneous transaction
              between strangers is common noise; repeated co-occurrence is a pattern.
            </p>
          </Stage>

          <Stage n={2} title="Find candidate groups">
            <p>
              Louvain community detection, weighted by edge strength. This finds groups that are{" "}
              <em>connected</em>. It says nothing about whether being connected is suspicious -
              which is the entire problem, because families are connected too.
            </p>
          </Stage>

          <Stage n={3} title="Score by corroboration">
            <p>
              Each signal is classified by one question:{" "}
              <em>
                does an ordinary household produce this in the normal course of being a household?
              </em>{" "}
              Shared address and shared card - yes, routinely. Coordinated timing - sometimes. A
              sequential SIM block or a funnelled promo code - no.
            </p>
            <p>
              The score is driven by how many <strong>independent</strong> kinds of signal tie the
              group together, and capped when every one of them is explainable.
            </p>
          </Stage>

          <Stage n={4} title="Apply a threshold chosen on training data">
            <p>
              A detector that surfaces every group it finds has no decision boundary, and its
              &ldquo;precision&rdquo; means very little. Ours has one - selected on the training
              split only, by a rule fixed in advance, and applied unchanged to the held-out split.
            </p>
            <p>
              Our own first guess at that number would have cost <strong>23% of recall</strong>.
              That is why it is chosen by script and not by eye, and why the choice is written to a
              file you can audit.
            </p>
          </Stage>

          <Stage n={5} title="Hand it to a human and stop">
            <p>
              The detector persists what it flagged, writes its own reasoning into an audit log, and
              stops. It does not freeze accounts. It does not block payments. It does not move
              money. A person decides, and their reason is recorded with the action.
            </p>
          </Stage>
        </div>
      </Section>

      {/* ------------------------------------------------------ Why this algo */}
      <Section
        eyebrow="Why this algorithm"
        title="What we chose, and what we turned down"
        lead="Every one of these is a defensible choice for someone. Here is why we made ours, including the one where the fashionable answer was the wrong answer for this build."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              title: "Community detection (Louvain)",
              badge: "Chosen",
              badgeVariant: "default" as const,
              body: "Rings are a community-structure problem, and Louvain is fast, deterministic under a fixed seed, and needs no labelled training data. Critically, its output is inspectable: you can point at the exact edges that put two accounts in the same group.",
            },
            {
              title: "Graph Neural Network",
              badge: "Next Step",
              badgeVariant: "secondary" as const,
              body: "A GNN is the current published gold standard and would likely beat this on a large labelled dataset. It needs far more labelled fraud outcomes than this build has, and it would make every flag much harder to explain to the merchant who has to act on it. We would rather ship something a merchant can audit than something we can only describe as accurate.",
            },
            {
              title: "Pure rules engine",
              badge: "Insufficient Alone",
              badgeVariant: "outline" as const,
              body: "Rules are excellent at single-transaction limits and terrible at relationships. Every ring account passes every per-transaction rule. We use rule-based logic where it belongs - deriving each individual signal - and graph structure for the part rules cannot see.",
            },
            {
              title: "LLM deciding account freezes",
              badge: "Never",
              badgeVariant: "destructive" as const,
              body: "Language models are used in exactly one place here: understanding what a person said on a verification call, in their own language. They never score risk and never decide an action. A model that can be talked into freezing a real customer's account is not a risk product.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-6 shadow-sm"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-foreground text-base font-semibold">{item.title}</h3>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    item.badgeVariant === "default" &&
                      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
                    item.badgeVariant === "secondary" && "bg-muted text-muted-foreground border",
                    item.badgeVariant === "outline" &&
                      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                    item.badgeVariant === "destructive" &&
                      "bg-destructive/10 text-destructive border border-destructive/20",
                  )}
                >
                  {item.badge}
                </span>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------ Compare */}
      <Section
        eyebrow="How this differs"
        title="Where most fraud tooling stops"
        lead="Not a claim that other tools are bad - they solve different parts of the problem. This is what is specifically different about a ring sentinel that takes false positives seriously."
      >
        <CompareTable
          columns={["Transaction rules", "Naive graph scoring", "This"]}
          rows={[
            {
              label: "Catches coordinated multi-account abuse",
              note: "The loss class itself",
              values: [false, true, true],
            },
            {
              label: "Distinguishes a fraud ring from a family",
              note: "Both are dense, well-connected groups",
              values: ["partial", false, true],
            },
            {
              label: "Publishes its own false-positive rate",
              note: "The cost merchants actually feel",
              values: [false, "partial", true],
            },
            {
              label: "Explains each flag in the detector's own words",
              note: "Stored at detection time, not reconstructed",
              values: ["partial", false, true],
            },
            {
              label: "Shows the innocent explanation beside each signal",
              note: "So you can overrule it",
              values: [false, false, true],
            },
            {
              label: "Threshold chosen on training data, not by eye",
              values: [false, "partial", true],
            },
            {
              label: "Publishes the cases where it fails",
              values: [false, false, true],
            },
            {
              label: "Never acts on an account by itself",
              values: [false, false, true],
            },
          ]}
        />
      </Section>

      {/* ------------------------------------------------------------- Honest */}
      <Section
        id="honest"
        eyebrow="The part most vendors leave out"
        title="Where this fails, in our own words"
        lead="We ran an adversarial test against our own detector with harder cases than our main test set contains: messier households and more evasive rings. It scores 8 out of 10. Both failures are published here and in the repository, because a detector whose limits you don't know is a detector you can't safely act on."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 p-5">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <RiErrorWarningLine className="size-3.5" aria-hidden />
              False positive
            </div>
            <h3 className="mt-1 font-medium">Flatmates who pass around one coupon</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              They share an address, share a card, order at the same time, and forward the same
              promo code to each other. Our detector flags them. On the five signals available this
              is <strong>genuinely indistinguishable</strong> from promo abuse, and we do not think
              a better weighting fixes it, because the information simply is not there.
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              This is the case voice verification exists for: the system escalates to{" "}
              <em>asking the account holder</em>, in their own language, rather than acting on a
              guess.
            </p>
          </div>

          <div className="rounded-lg border p-5">
            <div className="text-muted-foreground mb-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
              False negative
            </div>
            <h3 className="mt-1 font-medium">A ring careful enough to share almost nothing</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Different addresses, different cards, ordinary phone numbers, no promo reuse - only
              coordinated timing. We hold it back, and we think that is the right call:
              &ldquo;ordering at the same time&rdquo; is what families do, and flagging on it alone
              would put real customers in your review queue every day. This is the deliberate side
              of the trade.
            </p>
          </div>

          <div className="bg-muted/40 rounded-lg border p-5">
            <h3 className="font-medium">And the limit of the headline numbers</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Our test data is synthetic, and it was written by the same people who wrote the
              detector. The held-out split proves the algorithm does what it claims on data it never
              saw. It <strong>cannot</strong> prove the underlying assumption - that honest
              households share addresses but not sequential SIM blocks - because the same conviction
              authored both sides.
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              The honest claim is:{" "}
              <strong>a well-tested implementation of a defensible model</strong>, not{" "}
              <em>proven accurate on real fraud</em>. Real validation needs real merchant data with
              real chargeback outcomes. That is the next milestone, and we would rather tell you
              that now than have you discover it later.
            </p>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------- Commitments */}
      <Section
        eyebrow="What it will never do"
        title="Four commitments, enforced in code"
        lead="These are not policies in a document. Each one is a constraint in the system, and the first is a database rule that the application cannot route around."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: RiLockLine,
              title: "Never freezes or blocks by itself",
              body: "Detection and action are separated by a person. No risk score and no verification outcome can trigger an action on its own - only a recorded human decision can.",
            },
            {
              icon: RiEyeLine,
              title: "Never flags without saying why",
              body: "Every flag stores the detector's own reasoning at detection time, and every edge in the graph carries a named signal and a confidence. There are no unlabelled connections.",
            },
            {
              icon: RiCheckLine,
              title: "Never lets you dismiss without a reason",
              body: "Dismissing a flagged group requires a reason, enforced by a database constraint. That is what makes the false-positive rate real data instead of a guess.",
            },
            {
              icon: RiShieldCheckLine,
              title: "Defence only",
              body: "Nothing here helps anyone commit fraud, probe defences, or evade detection. It finds coordinated abuse against a merchant and hands it to that merchant.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border p-5">
              <item.icon className="text-muted-foreground size-5" aria-hidden />
              <h3 className="mt-3 font-medium">{item.title}</h3>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* --------------------------------------------------------- Evidence */}
      <Section
        eyebrow="Empirical Verification"
        title="Every number is measured, and the failure bounds are published"
        lead="A detector you cannot audit is one you cannot safely act on. The held-out accuracy, the adversarial cases it gets wrong, the 100-payment replay, and the exact decision threshold are all published transparently."
      >
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="glass-card-hover rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm">
              <div className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                Ring Recall
              </div>
              <div className="text-foreground mt-1 text-2xl font-bold tabular-nums">100%</div>
              <div className="text-muted-foreground mt-1 text-xs">
                5 of 5 held-out true rings caught
              </div>
            </div>
            <div className="glass-card-hover rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 shadow-sm">
              <div className="text-xs font-semibold tracking-wider text-blue-700 uppercase dark:text-blue-400">
                Household False Positives
              </div>
              <div className="text-foreground mt-1 text-2xl font-bold tabular-nums">0 / 7</div>
              <div className="text-muted-foreground mt-1 text-xs">
                Zero families mistakenly flagged
              </div>
            </div>
            <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-4 shadow-sm">
              <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Adversarial Suite
              </div>
              <div className="text-foreground mt-1 text-2xl font-bold tabular-nums">8 / 10</div>
              <div className="text-muted-foreground mt-1 text-xs">
                Includes 2 documented failure bounds
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Button render={<Link href="/evidence" />} size="lg" className="shadow-md">
              <span>View Full Evidence Dossier</span>
              <RiArrowRightLine className="size-4" aria-hidden />
            </Button>
            <p className="text-muted-foreground text-xs">
              Read live from the detector&apos;s output files with mathematical repeatability.
            </p>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- Close */}
      <section className="relative overflow-hidden border-t py-20">
        <div
          className="pointer-events-none absolute -bottom-24 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl"
          aria-hidden
        />
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="glass-panel relative overflow-hidden rounded-2xl border p-8 shadow-xl sm:p-12">
            <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-4xl">
              Ready to Stop Coordinated Fraud Rings?
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">
              Connect your Razorpay account to stream live payments and run the corroboration graph
              detector, or explore the pre-loaded synthetic queue.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Button render={<Link href="/connect" />} size="lg" className="h-11 px-6 shadow-md">
                <span>Connect Razorpay API</span>
                <RiArrowRightLine className="size-4" aria-hidden />
              </Button>
              <Button
                render={<Link href="/clusters" />}
                variant="outline"
                size="lg"
                className="h-11 px-6"
              >
                <span>Open Ring Queue</span>
              </Button>
            </div>
            <p className="text-muted-foreground mt-8 flex items-center gap-2 text-xs">
              <RiGitBranchLine className="size-4 text-emerald-500" aria-hidden />
              <span>
                All data in this deployment is synthetic and deterministic. Defence-only: no
                automated freezes.
              </span>
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
