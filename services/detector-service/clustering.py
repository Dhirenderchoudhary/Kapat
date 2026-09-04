"""Community detection over the account signal graph (Architecture.md §2.1, §3).

Phase 2. Louvain via networkx's built-in implementation, not python-louvain and not
a Graph Neural Network.

The GNN trade-off is deliberate and explained in Architecture.md §3 - simplicity and
explainability over marginal accuracy at this stage, not a shortcut to hide.

The python-louvain substitution is a real failure-recovery story, not a silent swap:
`pip install python-louvain` fails to build under modern setuptools (AttributeError:
install_layout - a known incompatibility in that package's old build backend). Architecture.md §4
names "python-louvain or networkx" explicitly, so networkx.algorithms.community.louvain_communities
- networkx's own Louvain implementation, same algorithm, zero extra dependency - is used instead.

Takes the graph from graph_builder.build_graph(), returns one set of account ids per detected
community at or above min_size. Communities below min_size (isolated accounts, or accidental
pairs too small to matter) are dropped - cluster_scorer.py (Phase 3) turns each surviving set
into a scored cluster with evidence.
"""

from __future__ import annotations

import networkx as nx
from networkx.algorithms.community import louvain_communities


def find_clusters(graph: nx.Graph, *, min_size: int = 2, seed: int = 42) -> list[set[str]]:
    if graph.number_of_edges() == 0:
        return []
    communities = louvain_communities(graph, weight="weight", seed=seed)
    return [set(community) for community in communities if len(community) >= min_size]
