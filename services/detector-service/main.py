"""FastAPI entrypoint for services/detector-service.

Contract (Architecture.md §6): POST /detect-rings is the single deep-module boundary this
service exposes - the caller (api/hono) sends accounts/transactions, gets back clusters with
evidence. Everything inside (graph_builder.py, clustering.py, cluster_scorer.py,
transaction_risk.py, chargeback_exposure.py) is an implementation detail behind that one
contract, per the codebase-design skill referenced in Rules.md.

Phase 2/3/4 status: wired for real. build_graph() -> find_clusters() -> score_cluster() is the
live pipeline (Architecture.md §2.1); score_cluster() also runs Phase 4's transaction_risk.py /
chargeback_exposure.py when accounts/transactions are supplied, per Phases.md's Phase 4 exit
criteria (a cluster's evidence includes a transaction risk contribution and a rupee exposure
figure, both traceable to specific transactions). This mirrors evaluate.py's pipeline call
exactly - no separate/divergent logic lives here (Rules.md: one deep module, not two).
"""

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import clustering
import cluster_scorer
import graph_builder

app = FastAPI(title="detector-service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "detector-service"}


class DetectRingsRequest(BaseModel):
    accounts: list[dict[str, Any]]
    transactions: list[dict[str, Any]]
    min_cluster_size: int = 2


class ClusterResult(BaseModel):
    member_account_ids: list[str]
    score: dict[str, Any]


class DetectRingsResponse(BaseModel):
    clusters: list[ClusterResult]


@app.post("/detect-rings", response_model=DetectRingsResponse)
def detect_rings(request: DetectRingsRequest) -> DetectRingsResponse:
    if not request.accounts or not request.transactions:
        raise HTTPException(
            status_code=422,
            detail="accounts and transactions must both be non-empty - nothing to build a graph from",
        )

    graph = graph_builder.build_graph(request.accounts, request.transactions)
    predicted = clustering.find_clusters(graph, min_size=request.min_cluster_size)

    clusters = [
        ClusterResult(
            member_account_ids=sorted(member_ids),
            score=cluster_scorer.score_cluster(
                graph,
                member_ids,
                accounts=request.accounts,
                transactions=request.transactions,
            ),
        )
        for member_ids in predicted
    ]

    return DetectRingsResponse(clusters=clusters)
