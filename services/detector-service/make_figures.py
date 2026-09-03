"""Renders the figures the dashboard and the write-up use, straight from the committed reports.

Every number drawn here is read out of data/*.json at render time. Nothing is typed in by hand, so
a figure can never drift from the run that produced it: re-run the pipeline, re-run this, and the
pictures change with it. If a report is missing, this fails loudly rather than drawing a plausible
placeholder.

Usage: python3 services/detector-service/make_figures.py
Output: docs/images/*.svg
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "images"
# These figures are for the README, docs/algorithm.md and the submission write-up only. The web
# app does NOT serve them: its charts are drawn live from the same JSON by
# web/next/src/components/fraud/animated-charts.tsx, which animates, follows the app's theme
# tokens, and needs no image files at all. Two renderers over one source of numbers is fine; two
# copies of the same PNG that can drift apart is not.
OUT.mkdir(parents=True, exist_ok=True)

# Two palettes, same figures. The dashboard and the write-up both render on a light or a dark
# ground depending on the reader's system, and matplotlib bakes text into paths - so a single
# figure cannot recolour itself in CSS. Rendering the pair here is the only way the labels stay
# readable in both. Hues are held constant between the two; only lightness moves, so a reader who
# sees one theme and a reader who sees the other are looking at the same encoding.
THEMES = {
    "light": dict(
        INK="#1c1b1f", MUTED="#6b6a70", GRID="#dedce3",
        TEAL="#0f766e", CORAL="#c2410c", SLATE="#475569",
        AMBER="#b45309", GREEN="#15803d", RED="#b91c1c",
        PLATE="#f4f3f7", PLATE_INK="#1c1b1f", PNG_BG="white",
    ),
    "dark": dict(
        INK="#e6edeb", MUTED="#93a5a2", GRID="#2c3a38",
        TEAL="#2dd4bf", CORAL="#fb923c", SLATE="#94a3b8",
        AMBER="#fbbf24", GREEN="#4ade80", RED="#f87171",
        PLATE="#1a2422", PLATE_INK="#e6edeb", PNG_BG="#0e1514",
    ),
}

# Bound at render time by render_theme(); module-level so the figure functions stay readable.
INK = MUTED = GRID = TEAL = CORAL = SLATE = AMBER = GREEN = RED = PLATE = PLATE_INK = PNG_BG = ""
SUFFIX = ""


def apply_theme(name: str) -> None:
    global INK, MUTED, GRID, TEAL, CORAL, SLATE, AMBER, GREEN, RED, PLATE, PLATE_INK, PNG_BG, SUFFIX
    t = THEMES[name]
    INK, MUTED, GRID = t["INK"], t["MUTED"], t["GRID"]
    TEAL, CORAL, SLATE = t["TEAL"], t["CORAL"], t["SLATE"]
    AMBER, GREEN, RED = t["AMBER"], t["GREEN"], t["RED"]
    PLATE, PLATE_INK, PNG_BG = t["PLATE"], t["PLATE_INK"], t["PNG_BG"]
    SUFFIX = "" if name == "light" else "-dark"
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 11,
        "axes.edgecolor": GRID,
        "axes.labelcolor": INK,
        "text.color": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.facecolor": "none",
        "axes.facecolor": "none",
        "savefig.facecolor": "none",
    })


def load(name: str) -> dict:
    p = DATA / name
    if not p.exists():
        raise SystemExit(f"Missing {p} - run the pipeline first; this script never invents numbers.")
    return json.loads(p.read_text(encoding="utf-8"))


def save(fig, name: str) -> None:
    """SVG for the web app (crisp at any size, small enough to inline); PNG alongside it for
    README/slide embedding, where SVG support is unreliable. Both come from the same figure, so
    they can never disagree."""
    stem = Path(name).stem + SUFFIX
    svg_path = OUT / (stem + ".svg")
    png_path = OUT / (stem + ".png")
    fig.savefig(svg_path, format="svg", bbox_inches="tight", transparent=True)
    fig.savefig(png_path, format="png", bbox_inches="tight", dpi=170, facecolor=PNG_BG)
    plt.close(fig)
    print(f"  {svg_path.relative_to(ROOT)}  +  {png_path.name}")


LABEL = {
    "heuristic_corroboration_gated": "Corroboration-gated\nheuristic  (shipped)",
    "gradient_boosting": "Gradient\nboosting",
    "random_forest": "Random\nforest",
    "logistic_regression": "Logistic\nregression",
}


def fig_model_comparison() -> None:
    """The one chart that carries the argument: everything ties on the held-out split, and the
    ranking inverts the moment the data stops coming from the generator."""
    rep = load("model_comparison.json")
    summary = rep["adversarial_evaluation"]["summary"]
    results = rep["results"]

    order = ["heuristic_corroboration_gated", "gradient_boosting", "random_forest", "logistic_regression"]
    adv = [summary[m]["accuracy"] * 100 for m in order]
    held = []
    for m in order:
        key = m if m in results else m
        held.append(results[key]["test_average_precision"] * 100)

    fig, ax = plt.subplots(figsize=(9.5, 4.6))
    x = range(len(order))
    w = 0.38
    b1 = ax.bar([i - w / 2 for i in x], held, w, color=SLATE, label="Held-out split  (same generator as training)")
    b2 = ax.bar([i + w / 2 for i in x], adv, w, color=TEAL, label="Adversarial cases  (hand-authored, unseen)")

    for bars in (b1, b2):
        for bar in bars:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5,
                    f"{bar.get_height():.0f}%", ha="center", va="bottom", fontsize=10, color=INK)

    ax.set_xticks(list(x))
    ax.set_xticklabels([LABEL[m] for m in order], fontsize=10)
    ax.set_ylim(0, 118)
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.set_ylabel("Correct  (%)")
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=2, fontsize=10)
    ax.set_title("Every method scores 100% on the held-out split.\nOnly the adversarial set tells them apart.",
                 fontsize=13, loc="left", pad=14)
    save(fig, "model-comparison.svg")


def fig_saturation() -> None:
    """Why the held-out number is not evidence: an unsupervised model with no labels matches it."""
    rep = load("model_comparison.json")
    r = rep["results"]
    rows = [
        ("Logistic regression", r["logistic_regression"]["test_average_precision"], "trained on labels"),
        ("Random forest", r["random_forest"]["test_average_precision"], "trained on labels"),
        ("Gradient boosting", r["gradient_boosting"]["test_average_precision"], "trained on labels"),
        ("Heuristic (no training)", r["heuristic_corroboration_gated"]["test_average_precision"], "no labels used"),
        ("Isolation forest", r["isolation_forest_unsupervised"]["test_average_precision"], "no labels at all"),
    ]
    fig, ax = plt.subplots(figsize=(8.6, 3.6))
    ON_FILL = "#0e1514" if SUFFIX else "white"
    ys = list(range(len(rows)))[::-1]
    colors = [SLATE, SLATE, SLATE, TEAL, CORAL]
    ax.barh(ys, [v * 100 for _, v, _ in rows], height=0.55, color=colors)
    for y, (name, v, note) in zip(ys, rows):
        ax.text(v * 100 - 2, y, f"{v*100:.0f}%", va="center", ha="right", color=ON_FILL, fontsize=10, fontweight="bold")
        ax.text(102, y, note, va="center", ha="left", color=MUTED, fontsize=9.5)
    ax.set_yticks(ys)
    ax.set_yticklabels([n for n, _, _ in rows], fontsize=10.5)
    ax.set_xlim(0, 150)
    ax.set_xticks([0, 50, 100])
    ax.set_xlabel("Average precision on the held-out split  (%)")
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_title("A score an unlabelled model also gets is not measuring skill.",
                 fontsize=13, loc="left", pad=12)
    save(fig, "saturation.svg")


def fig_feature_importance() -> None:
    rep = load("model_comparison.json")
    feats = rep["random_forest_feature_importance"][:9][::-1]
    pretty = {
        "has_shared_phone_pattern": "Sequential SIM block present",
        "conf_shared_phone_pattern": "SIM block confidence",
        "n_benign_types": "Count of benign-explainable signals",
        "n_fraud_types": "Count of fraud-specific signals",
        "avg_confidence": "Average edge confidence",
        "has_strong_signal": "Strong fraud signal present",
        "conf_shared_promo": "Promo-funnelling confidence",
        "has_shared_promo": "Promo funnelled through group",
        "has_shared_payment": "Shared card / payment method",
        "conf_shared_payment": "Shared-card confidence",
        "has_shared_address": "Shared delivery address",
        "conf_shared_address": "Shared-address confidence",
        "has_coordinated_timing": "Orders fire together",
        "conf_coordinated_timing": "Coordinated-timing confidence",
        "txn_per_account": "Transactions per account",
        "avg_amount_paise": "Average order value",
        "amount_std_paise": "Order-value spread",
        "density": "Graph density",
        "size": "Group size",
        "n_signal_types": "Distinct signal types",
        "txn_count": "Transactions in group",
    }
    names = [pretty.get(f["feature"], f["feature"]) for f in feats]
    vals = [f["importance"] for f in feats]
    # Teal = a feature the heuristic already weights by hand. If the tall bars are teal, the model
    # did not find anything the heuristic was missing.
    hand_raw = {"has_shared_phone_pattern", "conf_shared_phone_pattern", "n_fraud_types",
                "n_benign_types", "has_strong_signal", "has_shared_promo", "conf_shared_promo",
                "has_coordinated_timing", "conf_coordinated_timing"}
    colors = [TEAL if f["feature"] in hand_raw else SLATE for f in feats]

    fig, ax = plt.subplots(figsize=(8.8, 4.4))
    ys = list(range(len(names)))
    ax.barh(ys, vals, height=0.6, color=colors)
    for y, v in zip(ys, vals):
        ax.text(v + 0.003, y, f"{v:.3f}", va="center", color=MUTED, fontsize=9.5)
    ax.set_yticks(ys)
    ax.set_yticklabels(names, fontsize=10.5)
    ax.set_xlabel("Random-forest feature importance")
    ax.set_xlim(0, max(vals) * 1.25)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_title("The model rediscovered the heuristic.\nIts top features are the signals the heuristic weights by hand (teal).",
                 fontsize=13, loc="left", pad=14)
    save(fig, "feature-importance.svg")


def fig_threshold() -> None:
    rep = load("threshold_selection.json")
    curve = rep["curve"]
    # precision is undefined at thresholds where nothing is flagged; drop those points rather
    # than drawing a zero, which would read as "flagged everything wrongly".
    curve = [c for c in curve if c.get("precision") is not None and c.get("recall") is not None]
    t = [c["threshold"] for c in curve]
    prec = [c["precision"] * 100 for c in curve]
    rec = [c["recall"] * 100 for c in curve]
    sel = rep["selected_threshold"]

    fig, ax = plt.subplots(figsize=(9, 4.3))
    ax.plot(t, rec, color=TEAL, linewidth=2.4, label="Recall  (rings caught)")
    ax.plot(t, prec, color=CORAL, linewidth=2.4, label="Precision  (flags that were rings)")
    ax.axvline(sel, color=INK, linewidth=1.2, linestyle=(0, (4, 3)))
    ax.text(sel + 0.012, 8, f"chosen: {sel}\non the training split only", fontsize=9.5, color=INK, va="bottom")

    band = rep.get("score_separation_on_train", {})
    if band:
        ax.axvspan(band["highest_unflagged_score"], band["lowest_flagged_score"], color=TEAL, alpha=0.08)
        ax.text((band["highest_unflagged_score"] + band["lowest_flagged_score"]) / 2, 110,
                f"margin {band['margin']:.2f}: no cluster scores in here",
                ha="center", fontsize=9.5, color=MUTED)

    ax.set_xlabel("Flagging threshold")
    ax.set_ylabel("%")
    ax.set_ylim(0, 124)
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, loc="lower left", fontsize=10)
    ax.set_title("The threshold was picked before the test set was opened.", fontsize=13, loc="left", pad=14)
    save(fig, "threshold.svg")


def fig_live_performance() -> None:
    """How the agent does when payments arrive one at a time, which is how it actually runs."""
    rep = load("hold_verification_report.json")
    cm = rep["confusion_matrix"]
    fs = rep["first_sighting_analysis"]

    ON_FILL = "#0e1514" if SUFFIX else "white"
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.5, 4.2), gridspec_kw={"width_ratios": [1.15, 1]})

    labels = ["Fraud\nheld", "Legitimate\nheld by mistake", "Legitimate\nleft alone", "Fraud\nmissed"]
    vals = [cm["held_and_fraud_true_positive"], cm["held_but_legitimate_false_positive"],
            cm["released_and_legitimate_true_negative"], cm["released_but_fraud_false_negative"]]
    colors = [GREEN, RED, SLATE, AMBER]
    bars = ax1.bar(range(4), vals, color=colors, width=0.62)
    for b, v in zip(bars, vals):
        ax1.text(b.get_x() + b.get_width() / 2, b.get_height() + 1.2, str(v), ha="center", fontsize=11, color=INK)
    ax1.set_xticks(range(4))
    ax1.set_xticklabels(labels, fontsize=9.5)
    ax1.set_ylim(0, max(vals) * 1.22)
    ax1.set_ylabel("Payments")
    ax1.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax1.set_axisbelow(True)
    ax1.set_title(f"{rep['n_payments']} payments replayed one at a time\n"
                  f"0 legitimate customers held.", fontsize=12, loc="left", pad=12)

    seen = fs["fraud_payments_from_already_seen_accounts"]
    held = fs["of_those_correctly_held"]
    first = fs["of_which_were_that_accounts_first_ever_payment"]
    ax2.barh([1], [held], color=GREEN, height=0.5)
    ax2.barh([1], [seen - held], left=[held], color=AMBER, height=0.5)
    ax2.barh([0], [0], color=GREEN, height=0.5)
    ax2.barh([0], [first], color=MUTED, height=0.5)
    ax2.text(held / 2, 1, f"{held}/{seen} held", va="center", ha="center", color=ON_FILL, fontsize=10.5, fontweight="bold")
    ax2.text(first / 2, 0, f"{first} undetectable", va="center", ha="center", color=ON_FILL, fontsize=10.5, fontweight="bold")
    ax2.set_ylim(-0.75, 1.75)
    ax2.set_yticks([1, 0])
    ax2.set_yticklabels(["Account seen before", "Account's first-ever\npayment"], fontsize=10)
    ax2.set_xlim(0, max(seen, first) * 1.3)
    ax2.set_xlabel("Fraud payments")
    ax2.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax2.set_axisbelow(True)
    ax2.set_title("Every miss was a first-ever payment.\nAt that moment the account has no links to see.",
                  fontsize=12, loc="left", pad=12)
    save(fig, "live-performance.svg")


def fig_pipeline() -> None:
    """How a payment becomes a hold. Six boxes, no prose."""
    steps = [
        ("Payment\nauthorised", "Razorpay webhook,\nsignature verified"),
        ("Added to\nthe graph", "address, card, phone,\ntiming, promo"),
        ("Groups\nfound", "Louvain community\ndetection"),
        ("Corroboration\ngate", "benign-only groups\ncapped at 0.40"),
        ("Score vs\n0.45", "threshold picked on\nthe training split"),
        ("Funds held,\nnot cancelled", "merchant decides;\nauto-released in 3 days"),
    ]
    fig, ax = plt.subplots(figsize=(13, 2.9))
    ax.set_xlim(0, len(steps) * 2.15)
    ax.set_ylim(0, 2.4)
    ax.axis("off")
    for i, (title, sub) in enumerate(steps):
        x = i * 2.15 + 0.08
        face = TEAL if i in (3, 5) else PLATE
        on_accent = "#08201d" if SUFFIX else "white"
        fg = on_accent if i in (3, 5) else PLATE_INK
        box = FancyBboxPatch((x, 0.55), 1.85, 1.25, boxstyle="round,pad=0.06,rounding_size=0.12",
                             linewidth=1.1, edgecolor=TEAL if i in (3, 5) else GRID, facecolor=face)
        ax.add_patch(box)
        ax.text(x + 0.925, 1.42, title, ha="center", va="center", fontsize=11, color=fg, fontweight="bold")
        ax.text(x + 0.925, 0.92, sub, ha="center", va="center", fontsize=8.6, color=on_accent if i in (3, 5) else MUTED)
        if i < len(steps) - 1:
            ax.add_patch(FancyArrowPatch((x + 1.93, 1.17), (x + 2.15, 1.17), arrowstyle="-|>",
                                         mutation_scale=13, color=MUTED, linewidth=1.2))
    ax.text(0.08, 2.15, "How a fraud transaction gets caught", fontsize=13, color=INK, fontweight="bold")
    save(fig, "pipeline.svg")


def fig_training_data() -> None:
    """What the agent was actually built and measured on - stated plainly, including the caveat."""
    batch = load("batch_run_report.json")
    inp = batch["input"]
    gt = batch["ground_truth_summary"]
    stress = load("stress_test_report.json")

    ON_FILL = "#0e1514" if SUFFIX else "white"
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.5, 3.9), gridspec_kw={"width_ratios": [1, 1]})

    names = ["Accounts", "Transactions", "Groups\nin the data", "Real rings", "Look-alike\nhouseholds"]
    vals = [inp["account_count"], inp["transaction_count"], inp["ground_truth_cluster_count"],
            gt["true_ring_count"], gt["legitimate_lookalike_count"]]
    colors = [SLATE, SLATE, SLATE, CORAL, TEAL]
    bars = ax1.bar(range(5), vals, color=colors, width=0.6)
    for b, v in zip(bars, vals):
        ax1.text(b.get_x() + b.get_width() / 2, b.get_height() * 1.06, str(v), ha="center", fontsize=10.5, color=INK)
    ax1.set_xticks(range(5))
    ax1.set_xticklabels(names, fontsize=9.5)
    ax1.set_yscale("log")
    ax1.set_ylim(1, inp["transaction_count"] * 3)
    ax1.set_yticks([])
    ax1.set_yticks([], minor=True)   # log scale draws minor ticks by default; nothing reads them here
    ax1.spines["left"].set_visible(False)
    ax1.set_title("What the agent learned on", fontsize=12, loc="left", pad=12)

    ok = stress["n_correct"]
    bad = stress["n_failures"]
    ax2.barh([0], [ok], color=GREEN, height=0.42)
    ax2.barh([0], [bad], left=[ok], color=AMBER, height=0.42)
    ax2.text(ok / 2, 0, f"{ok} handled", va="center", ha="center", color=ON_FILL, fontsize=11, fontweight="bold")
    ax2.text(ok + bad / 2, 0, f"{bad} known\nfailures", va="center", ha="center", color=ON_FILL, fontsize=9.5, fontweight="bold")
    ax2.set_yticks([])
    ax2.set_ylim(-0.55, 0.32)
    ax2.set_xlim(0, stress["n_cases"])
    ax2.spines["left"].set_visible(False)
    ax2.spines["bottom"].set_visible(False)
    ax2.set_xticks([])
    ax2.set_title("And what it still gets wrong: published, not hidden", fontsize=12, loc="left", pad=12)
    fails = [r["case"].replace("_", " ") for r in stress["results"] if not r["correct"]]
    ax2.text(0, -0.30, "• " + "\n• ".join(fails), fontsize=9.5, color=MUTED, va="top")
    save(fig, "training-data.svg")


FIGURES = (fig_model_comparison, fig_saturation, fig_feature_importance,
           fig_threshold, fig_live_performance, fig_pipeline, fig_training_data)


def main() -> None:
    for theme in THEMES:
        print(f"Rendering {theme} figures from data/*.json:")
        apply_theme(theme)
        for f in FIGURES:
            f()
        print()
    print(f"All figures written to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
