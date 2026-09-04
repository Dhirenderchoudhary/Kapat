import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"

import { accounts, accountLinks, auditLog, clusterMembers, clusters, db } from "@packages/db"

function deterministicId(prefix: string, parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20)
  return `${prefix}_${hash}`
}

async function main() {
  console.log("Running Python Louvain graph detector on full dataset...")
  const pyCode = `
import sys, json
sys.path.insert(0, 'services/detector-service')
import run_batch, graph_builder, clustering, cluster_scorer
data = run_batch.load_combined_dataset()
graph = graph_builder.build_graph(data['accounts'], data['transactions'])
predicted = clustering.find_clusters(graph)
scored = [
    {
        'members': sorted(cluster),
        'score': cluster_scorer.score_cluster(graph, cluster, accounts=data['accounts'], transactions=data['transactions'])
    }
    for cluster in predicted
]
print(json.dumps(scored))
`
  const proc = spawnSync("python3", ["-c", pyCode], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  })
  if (proc.error || proc.status !== 0) {
    console.error("Python detector failed:", proc.stderr || proc.error)
    process.exit(1)
  }

  const allClusters = JSON.parse(proc.stdout)
  const flagged = allClusters.filter((c: any) => c.score.flagged)
  console.log(
    `Detected ${allClusters.length} total clusters, persisting ${flagged.length} flagged rings to Supabase DB...`,
  )

  const allAccounts = await db
    .select({ id: accounts.id, customerRef: accounts.customerRef })
    .from(accounts)
  const idByCustomerRef = new Map(allAccounts.map((a) => [a.customerRef, a.id]))

  const train = await import("../../../data/detector_train.json", { with: { type: "json" } })
  const test = await import("../../../data/detector_test.json", { with: { type: "json" } })
  const trainAccounts = (train.accounts || train.default?.accounts || []).concat(
    test.accounts || test.default?.accounts || [],
  )
  const dbIdByRawId = new Map(
    trainAccounts.map((a: any) => [a.id, idByCustomerRef.get(a.customer_ref) ?? a.id]),
  )

  let clustersPersisted = 0
  let linksPersisted = 0

  await db.transaction(async (tx) => {
    for (const detected of flagged) {
      const mappedMembers: string[] = detected.members
        .map((rawId: string) => dbIdByRawId.get(rawId) ?? rawId)
        .sort()
      const clusterId = deterministicId("cl_live", mappedMembers)

      const [insertedCluster] = await tx
        .insert(clusters)
        .values({
          id: clusterId,
          riskScore: detected.score.risk_score,
          chargebackExposurePaise: detected.score.chargeback_exposure_paise ?? null,
        })
        .onConflictDoNothing({ target: clusters.id })
        .returning({ id: clusters.id })

      if (insertedCluster) {
        clustersPersisted += 1
        await tx
          .insert(clusterMembers)
          .values(mappedMembers.map((accountId) => ({ clusterId, accountId })))
          .onConflictDoNothing()

        await tx.insert(auditLog).values({
          clusterId,
          payload: {
            event: "cluster_detected",
            detectedBy: "detector-service /detect-rings",
            riskScore: detected.score.risk_score,
            rawRiskScore: detected.score.raw_risk_score,
            flagThreshold: detected.score.flag_threshold,
            ceilingApplied: detected.score.ceiling_applied,
            explanation: detected.score.explanation,
            features: detected.score.features,
            memberAccountIds: mappedMembers,
            note: "Detection only. Coordinated fraud ring surfaced for merchant review.",
          },
        })
      }

      for (const evidence of detected.score.evidence) {
        const rawA = evidence.accounts_involved[0]
        const rawB = evidence.accounts_involved[1]
        const accA = dbIdByRawId.get(rawA) ?? rawA
        const accB = dbIdByRawId.get(rawB) ?? rawB
        const [accountA, accountB] = [accA, accB].sort() as [string, string]
        const linkId = deterministicId("link", [accountA, accountB, evidence.signal_type])
        const [insertedLink] = await tx
          .insert(accountLinks)
          .values({
            id: linkId,
            accountA,
            accountB,
            signalType: evidence.signal_type,
            confidence: evidence.confidence,
          })
          .onConflictDoNothing({
            target: [accountLinks.accountA, accountLinks.accountB, accountLinks.signalType],
          })
          .returning({ id: accountLinks.id })
        if (insertedLink) linksPersisted += 1
      }
    }
  })

  console.log(
    `Success! Persisted ${clustersPersisted} fraud clusters and ${linksPersisted} evidence links to Supabase.`,
  )
}

main().catch((err) => {
  console.error("Migration error:", err)
  process.exit(1)
})
