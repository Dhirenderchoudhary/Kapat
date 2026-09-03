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
import model_scorer

app = FastAPI(title="detector-service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "detector-service"}


@app.get("/model")
def model() -> dict:
    """Which brain is actually running, and what it scored on held-out data.

    Worth its own endpoint because "is the trained model live, or did it quietly fall back to the
    rule?" is a question the dashboard must be able to answer out loud. A fallback that nobody can
    see is indistinguishable from a model that was never trained.
    """
    return model_scorer.model_info()


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

    clusters = []
    for member_ids in predicted:
        score = cluster_scorer.score_cluster(
            graph,
            member_ids,
            accounts=request.accounts,
            transactions=request.transactions,
        )

        # Fold in the trained model where one is available. Three properties matter here:
        #
        #   - The heuristic ALWAYS runs, and its explanation always survives. The model supplies a
        #     better number; the rule supplies the sentence a merchant can act on. Neither is
        #     sufficient alone, which is why both are in the response.
        #   - When the model is present its verdict decides `flagged`, because on realistic data it
        #     makes 2 costly errors where the rule makes 35. `heuristic_risk_score` is preserved
        #     beside it so nothing is lost.
        #   - `scorer` and `scorers_agree` are reported explicitly. Disagreement between a
        #     hand-built rule and a trained model is the most interesting signal on the screen, and
        #     averaging the two into one number would destroy it.
        model = model_scorer.score(
            graph, member_ids, request.accounts, request.transactions, score["risk_score"]
        )
        if model and "model_risk_score" in model:
            score["heuristic_risk_score"] = score["risk_score"]
            score["heuristic_flagged"] = score["flagged"]
            score.update(model)
            score["risk_score"] = model["model_risk_score"]
            score["flagged"] = model["model_flagged"]
            score["scorer"] = "trained_model"
            score["scorers_agree"] = bool(score["heuristic_flagged"] == model["model_flagged"])
        else:
            score["scorer"] = "heuristic"
            if model and "model_error" in model:
                score["model_error"] = model["model_error"]

        clusters.append(
            ClusterResult(member_account_ids=sorted(member_ids), score=score)
        )

    return DetectRingsResponse(clusters=clusters)
