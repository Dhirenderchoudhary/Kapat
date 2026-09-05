import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import { migrate } from "drizzle-orm/postgres-js/migrator"

const testUrl = process.env.TEST_POSTGRES_URL
if (testUrl) {
  const url = new URL(testUrl)
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/razorpay_perf_test"
  ) {
    throw new Error("Performance tests require a local, disposable razorpay_perf_test database")
  }
  process.env.POSTGRES_URL = testUrl
  process.env.NODE_ENV = "test"
  process.env.SKIP_ENV_VALIDATION = "true"
}

// Integration tests intentionally opt in to a disposable database. No configured app database
// is read or modified, and only GET handlers run, so payment actions and pollers never start.
describe.skipIf(!testUrl)("dashboard query performance", () => {
  let tables: typeof import("@packages/db")
  let analytics: typeof import("@/routers/analytics").analyticsRouter
  let rings: typeof import("@/routers/clusters").clustersRouter
  let razorpay: typeof import("@/routers/razorpay").razorpayRouter

  beforeAll(async () => {
    tables = await import("@packages/db")
    await migrate(tables.db, {
      migrationsFolder: resolve(import.meta.dir, "../../../../packages/db/drizzle"),
    })
    analytics = (await import("@/routers/analytics")).analyticsRouter
    rings = (await import("@/routers/clusters")).clustersRouter
    razorpay = (await import("@/routers/razorpay")).razorpayRouter
    // This database is explicitly disposable; reset fixtures to make reruns reproducible.
    await tables.db.delete(tables.razorpayConnections)
    await tables.db.delete(tables.clusters)
    await tables.db.delete(tables.accounts)
  })

  afterAll(async () => {
    const db = tables?.db as typeof tables.db & { $client: { end: () => Promise<void> } }
    await db?.$client.end()
  })

  test("empty database keeps the zero-state contract and reports no data", async () => {
    const response = await analytics.request("/")
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.totals.transactions).toBe(0)
    expect(data.riskDistribution.map((b: { count: number }) => b.count)).toEqual(Array(8).fill(0))
    expect(data.clusterSizes).toEqual([])
    const status = await razorpay.request("/status")
    expect((await status.json()).data).toMatchObject({ connected: false, hasData: false })
  })

  test("aggregates preserve bucket boundaries, overlapping membership, amounts and status", async () => {
    const {
      db,
      accounts,
      transactions,
      clusters,
      clusterMembers,
      accountLinks,
      merchantDecisions,
      auditLog,
    } = tables
    await db
      .insert(accounts)
      .values(["a", "b", "c", "clean"].map((id) => ({ id, customerRef: id })))
    await db.insert(transactions).values([
      { id: "t1", razorpayEventId: "e1", accountId: "a", amountPaise: 100 },
      { id: "t2", razorpayEventId: "e2", accountId: "a", amountPaise: 200 },
      { id: "t3", razorpayEventId: "e3", accountId: "b", amountPaise: 300 },
      { id: "t4", razorpayEventId: "e4", accountId: "clean", amountPaise: 400 },
    ])
    await db.insert(clusters).values(
      [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1].map((riskScore, i) => ({
        id: `c${i}`,
        riskScore,
        status: i === 8 ? "resolved" : "pending_review",
        chargebackExposurePaise: i === 8 ? 500 : null,
      })),
    )
    await db.insert(clusterMembers).values([
      { clusterId: "c7", accountId: "a" },
      { clusterId: "c7", accountId: "b" },
      { clusterId: "c8", accountId: "a" },
      { clusterId: "c8", accountId: "b" },
      { clusterId: "c8", accountId: "c" },
    ])
    await db.insert(accountLinks).values({
      id: "link",
      accountA: "a",
      accountB: "b",
      signalType: "shared_promo",
      confidence: 0.75,
    })
    await db.insert(merchantDecisions).values({
      id: "decision",
      clusterId: "c8",
      action: "dismiss",
      reason: "household",
      decidedBy: "test",
    })
    await db.insert(auditLog).values({ id: "audit", clusterId: "c8", payload: { event: "test" } })

    const response = await analytics.request("/")
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.totals).toEqual({
      accounts: 4,
      transactions: 4,
      transactionVolumePaise: 1000,
      accountsInFlaggedRings: 3,
      clustersFlagged: 9,
      decisionsMade: 1,
      auditEntries: 1,
    })
    expect(data.flaggedShare).toEqual({
      accountsFlagged: 3,
      accountsClean: 1,
      transactionsInFlaggedRings: 3,
      transactionsClean: 1,
      exposurePaise: 500,
    })
    expect(data.riskDistribution.map((b: { count: number }) => b.count)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 2,
    ])
    expect(data.clusterSizes).toEqual([
      { size: 2, clusters: 1 },
      { size: 3, clusters: 1 },
    ])
    expect(data.statusBreakdown).toEqual({ pending_review: 8, resolved: 1 })
    expect(data.decisionBreakdown).toEqual({ dismiss: 1 })
    expect(data.signalBreakdown).toEqual([
      { signalType: "shared_promo", signalClass: "strong_fraud_specific", edges: 1 },
    ])

    const status = await razorpay.request("/status")
    expect((await status.json()).data).toMatchObject({ connected: false, hasData: true })
    const list = await rings.request("/?perPage=2")
    expect(
      (await list.json()).data.clusters.map((c: { accountCount: number }) => c.accountCount),
    ).toEqual([3, 2])
    const detail = await rings.request("/c8")
    expect(detail.status).toBe(200)
    const cluster = (await detail.json()).data
    expect(cluster.accounts.map((a: { transactionCount: number }) => a.transactionCount)).toEqual([
      2, 1, 0,
    ])
    expect(cluster.evidence).toHaveLength(1)
    expect(cluster.decisions).toHaveLength(1)
    expect(cluster.auditLog).toHaveLength(1)
  })
})
