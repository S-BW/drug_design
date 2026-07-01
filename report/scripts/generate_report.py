#!/usr/bin/env python3
"""
Generate a comprehensive project report for the AMPC small-molecule generation project.

This report covers the full project arc (hypothesis -> implementation -> results)
and is aimed at a biology-oriented supervisor.

Outputs (under report/):
    images/*.png          static charts, pipeline diagrams and molecule grids
    data/report_data.json summary numbers and top-candidate table
    data/top_candidates.csv
    index.html            full-project narrative report
"""

import argparse
import base64
import io
import json
import math
import warnings
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from rdkit import Chem
from rdkit.Chem import AllChem, Descriptors, Draw, rdMolDescriptors
from rdkit.Chem.FilterCatalog import FilterCatalog, FilterCatalogParams
from rdkit.Contrib.SA_Score import sascorer
from rdkit.Chem.Draw import rdMolDraw2D
from sklearn.manifold import TSNE

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RISK_ORDER = ["Low", "Low-Medium", "Medium", "Marginal", "High"]
RISK_PALETTE = {
    "High": "#d62728",
    "Marginal": "#ff7f0e",
    "Medium": "#ffdd44",
    "Low-Medium": "#87ceeb",
    "Low": "#2ca02c",
}
TIER_ORDER = [0, 1, 2, 3]
TIER_LABELS = {0: "Failed (0/3)", 1: "Tier C (1/3)", 2: "Tier B (2/3)", 3: "Tier A (3/3)"}
TIER_COLORS = {0: "#d62728", 1: "#ff7f0e", 2: "#ffdd44", 3: "#2ca02c"}

PROPERTY_COLS = {
    "mw": "Molecular weight (Da)",
    "logp": "LogP",
    "tpsa": "TPSA (Å²)",
    "qed": "QED drug-likeness",
    "sa_score": "SA score",
    "tanimoto_to_ampc": "Tanimoto to AMPC",
}

KEY_METRICS = [
    "integrated_score",
    "gnina_cnn_affinity",
    "gnina_affinity",
    "gnina_warhead_dist_min",
    "vina_top_affinity",
    "metric_binding_confidence",
    "metric_structure_confidence",
    "composite_score",
    "composite_score_norm",
    "admet_tier_score",
    "admet_tier_norm",
    "qed",
    "sa_score",
    "tanimoto_to_ampc",
    "mw",
    "logp",
    "tpsa",
    "hbd",
    "hba",
    "rotb",
    "n_chiral",
    "warhead_geo_norm",
    "structural_alert_score",
    "alert_count",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--candidates",
        default="REINVENT4/output/unified_analysis/candidates_top500.csv",
        help="Top-500 candidate CSV from the unified analysis",
    )
    parser.add_argument(
        "--ranking",
        default="integrated_analysis/output/overall_ranking.csv",
        help="Final integrated ranking CSV",
    )
    parser.add_argument(
        "--ampc",
        default="REINVENT4/data/ampc.smi",
        help="AMPC reference SMILES file",
    )
    parser.add_argument(
        "--output-dir",
        default="report",
        help="Directory where the report will be written",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=25,
        help="Number of top molecules to highlight",
    )
    return parser.parse_args()


def count_csv_rows(path: Path) -> int:
    """Fast row count for large CSVs (excluding header)."""
    if not path.exists():
        return 0
    with open(path, "rb") as f:
        return sum(1 for _ in f) - 1


def canonical_smiles(smi: str):
    mol = Chem.MolFromSmiles(str(smi))
    if mol is None:
        return None
    return Chem.MolToSmiles(mol)


def count_chiral_centers(smi: str) -> int:
    """Count potential tetrahedral stereocenters (assigned or unassigned)."""
    mol = Chem.MolFromSmiles(str(smi))
    if mol is None:
        return 0
    Chem.AssignStereochemistry(mol, force=True, cleanIt=True)
    return len(Chem.FindMolChiralCenters(mol, includeUnassigned=True))


def load_data(args):
    project_root = Path(args.ranking).resolve().parent.parent.parent
    cand = pd.read_csv(args.candidates)
    rank = pd.read_csv(args.ranking)

    cand["canonical_smiles"] = cand["canonical_smiles"].astype(str).str.strip()
    rank["canonical_smiles"] = rank["canonical_smiles"].astype(str).str.strip()

    df = rank.merge(
        cand,
        on="canonical_smiles",
        how="left",
        suffixes=("", "_cand"),
    )
    for col in ["best_source", "composite_score", "tanimoto_to_ampc"]:
        if f"{col}_cand" in df.columns:
            df[col] = df[col].fillna(df[f"{col}_cand"])
            df.drop(columns=[f"{col}_cand"], inplace=True)

    df["patent_risk_level"] = pd.Categorical(
        df["patent_risk_level"].fillna("Low"), categories=RISK_ORDER, ordered=True
    )

    if "qed" not in df.columns and "QED" in df.columns:
        df["qed"] = df["QED"]
    if "qed" not in df.columns:
        df["qed"] = df["canonical_smiles"].apply(
            lambda s: Descriptors.qed(Chem.MolFromSmiles(s)) if Chem.MolFromSmiles(s) else np.nan
        )

    df["n_chiral"] = df["canonical_smiles"].apply(count_chiral_centers)

    ampc_smiles = None
    if Path(args.ampc).exists():
        with open(args.ampc) as f:
            ampc_smiles = f.readline().split()[0].strip()

    # -----------------------------------------------------------------------
    # Append AMPC reference row so the full table contains 501 molecules
    # -----------------------------------------------------------------------
    candidates_stats = {
        "gnina_cnn_affinity_min": rank["gnina_cnn_affinity"].min(),
        "gnina_cnn_affinity_max": rank["gnina_cnn_affinity"].max(),
        "boltz_binding_confidence_min": rank["metric_binding_confidence"].min(),
        "boltz_binding_confidence_max": rank["metric_binding_confidence"].max(),
        "composite_score_min": rank["composite_score"].min(),
        "composite_score_max": rank["composite_score"].max(),
        "vina_top_affinity_min": rank["vina_top_affinity"].min(),
        "vina_top_affinity_max": rank["vina_top_affinity"].max(),
    }
    ampc_row = _build_ampc_row(args, ampc_smiles, df.columns.tolist(), candidates_stats)
    if ampc_row is not None:
        df = pd.concat([df, ampc_row], ignore_index=True)

    # -----------------------------------------------------------------------
    # Flag molecules that had to be retried because Boltz's internal SMARTS
    # catalog filtered them in the initial run.
    # -----------------------------------------------------------------------
    df["boltz_retry"] = False
    retry_path = project_root / "boltz" / "output" / "boltzmol_retry_results.csv"
    if retry_path.is_file():
        try:
            retry_ids = pd.read_csv(retry_path)["external_id"].astype(str).tolist()
            retried_idx = {
                int(x[3:]) for x in retry_ids
                if x.startswith("mol") and x[3:].isdigit()
            }
            df.loc[df["idx"].isin(retried_idx), "boltz_retry"] = True
        except Exception:
            pass

    return df, ampc_smiles


def _build_ampc_row(args, ampc_smiles, target_cols, stats):
    """Build a single-row DataFrame for the AMPC reference molecule."""
    if not ampc_smiles:
        return None

    project_root = Path(args.ranking).resolve().parent.parent.parent

    # Start with basic fields
    row = {
        "idx": 0,
        "canonical_smiles": ampc_smiles,
        "best_source": "AMPC_reference",
        "overall_rank": 0,  # AMPC reference placed at the top, candidates follow 1..500
        "composite_score": np.nan,
        "composite_score_norm": np.nan,
        "admet_tier_score": 0,
        "admet_tier_norm": 0.0,
        "gnina_cnn_affinity": np.nan,
        "gnina_cnn_affinity_norm": np.nan,
        "gnina_affinity": np.nan,
        "gnina_warhead_dist_min": np.nan,
        "gnina_distance_filter_pass": False,
        "vina_top_affinity": np.nan,
        "vina_affinity_norm": np.nan,
        "metric_binding_confidence": np.nan,
        "boltz_binding_confidence_norm": np.nan,
        "metric_complex_plddt": np.nan,
        "metric_complex_iplddt": np.nan,
        "metric_iptm": np.nan,
        "metric_ptm": np.nan,
        "metric_structure_confidence": np.nan,
        "pains_alert": False,
        "brenk_alert": False,
        "any_alert": False,
        "alert_count": 0,
        "pains_names": "",
        "brenk_names": "",
        "tanimoto_to_ampc": 1.0,
        "strict_core_match": True,
        "lactone_core_any_phenyl": True,
        "lactone_core": True,
        "chromene_phenyl": True,
        "chromene_any": True,
        "patent_risk_note": "AMPC reference molecule",
        "patent_risk_level": "High",
        "warhead_geo_norm": np.nan,
        "structural_alert_score": 1.0,
        "integrated_score": np.nan,
        "n_chiral": count_chiral_centers(ampc_smiles),
    }

    # GNINA
    gnina_path = project_root / "gnina" / "output" / "gnina_docking_summary.csv"
    if gnina_path.is_file():
        gnina = pd.read_csv(gnina_path)
        ampc_gnina = gnina[gnina["source"] == "AMPC_reference"]
        if not ampc_gnina.empty:
            g = ampc_gnina.iloc[0]
            row["gnina_affinity"] = g.get("affinity", np.nan)
            row["gnina_cnn_affinity"] = g.get("cnn_affinity", np.nan)
            row["gnina_cnn_score"] = g.get("cnn_score", np.nan)
            row["gnina_warhead_dist_min"] = g.get("warhead_dist_min", np.nan)
            row["gnina_distance_filter_pass"] = bool(g.get("distance_filter_pass", False))

    # ADMET
    admet_path = project_root / "admetlab3" / "output" / "analysis" / "admet_all_flags.csv"
    if admet_path.is_file():
        admet = pd.read_csv(admet_path)
        ampc_admet = admet[admet["_idx"] == 0]
        if not ampc_admet.empty:
            a = ampc_admet.iloc[0]
            row["QED"] = a.get("QED", np.nan)
            row["qed"] = a.get("QED", np.nan)
            row["PAINS"] = a.get("PAINS", 0)
            # Core drug-like properties for property-distribution comparisons
            row["mw"] = a.get("Molecular Weight (MW)", np.nan)
            row["logp"] = a.get("logP", np.nan)
            row["tpsa"] = a.get("TPSA", np.nan)
            row["hbd"] = a.get("nHD", np.nan)
            row["hba"] = a.get("nHA", np.nan)
            row["rotb"] = a.get("nRot", np.nan)
            row["pass_tier_a"] = bool(a.get("pass_tier_a", False))
            row["pass_tier_b"] = bool(a.get("pass_tier_b", False))
            row["pass_tier_c"] = bool(a.get("pass_tier_c", False))
            if row["pass_tier_a"]:
                row["admet_tier_score"] = 3
            elif row["pass_tier_b"]:
                row["admet_tier_score"] = 2
            elif row["pass_tier_c"]:
                row["admet_tier_score"] = 1
            else:
                row["admet_tier_score"] = 0
            row["admet_tier_norm"] = row["admet_tier_score"] / 3.0

    # Boltz
    boltz_path = project_root / "boltz" / "output" / "boltzmol_all_results.csv"
    if boltz_path.is_file():
        boltz = pd.read_csv(boltz_path)
        ampc_boltz = boltz[boltz["external_id"] == "mol0000"]
        if not ampc_boltz.empty:
            b = ampc_boltz.iloc[0]
            for col in ["metric_binding_confidence", "metric_complex_plddt",
                        "metric_complex_iplddt", "metric_iptm", "metric_ptm",
                        "metric_structure_confidence"]:
                row[col] = b.get(col, np.nan)

    # Vina: AMPC was redocked separately; read the redock log first, then fall
    # back to a canonical-SMILES match in the candidate docking summary.
    redock_log = project_root / "autodock_vina" / "batch_docking" / "output" / "ampc_redock.log"
    if redock_log.is_file():
        try:
            with open(redock_log, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("REMARK Redocked affinity:"):
                        parts = line.split(":")
                        if len(parts) >= 2:
                            row["vina_top_affinity"] = float(parts[1].strip().split()[0])
                        break
        except Exception:
            pass

    if pd.isna(row.get("vina_top_affinity")):
        vina_path = Path(args.vina_csv) if hasattr(args, "vina_csv") else project_root / "autodock_vina" / "batch_docking" / "output" / "docking_summary.csv"
        if vina_path.is_file():
            try:
                vina = pd.read_csv(vina_path)
                smiles_col = next((c for c in vina.columns if "smiles" in c.lower()), None)
                if smiles_col:
                    canon_vina = vina[smiles_col].apply(lambda s: canonical_smiles(str(s)) if pd.notna(s) else None)
                    ampc_vina = vina[canon_vina == canonical_smiles(ampc_smiles)]
                    if not ampc_vina.empty:
                        affinity_col = next((c for c in vina.columns if "affinity" in c.lower()), None)
                        if affinity_col:
                            row["vina_top_affinity"] = ampc_vina.iloc[0].get(affinity_col, np.nan)
            except Exception:
                pass

    # Structural alerts (PAINS/BRENK)
    mol = Chem.MolFromSmiles(ampc_smiles)
    if mol is not None:
        params = FilterCatalogParams()
        params.AddCatalog(FilterCatalogParams.FilterCatalogs.PAINS)
        params.AddCatalog(FilterCatalogParams.FilterCatalogs.BRENK)
        catalog = FilterCatalog(params)
        matches = catalog.GetMatches(mol)
        p_names, b_names = [], []
        for match in matches:
            filter_set = ""
            if "FilterSet" in match.GetPropList():
                filter_set = str(match.GetProp("FilterSet")).upper()
            desc = match.GetDescription()
            if "PAINS" in filter_set or "PAINS" in desc.upper():
                p_names.append(desc)
            elif "BRENK" in filter_set or "BRENK" in desc.upper():
                b_names.append(desc)
        row["pains_alert"] = bool(p_names)
        row["brenk_alert"] = bool(b_names)
        row["any_alert"] = bool(p_names or b_names)
        row["alert_count"] = len(p_names) + len(b_names)
        row["pains_names"] = ";".join(p_names)
        row["brenk_names"] = ";".join(b_names)
        row["structural_alert_score"] = 1.0 - 0.5 * float(row["any_alert"])
        try:
            row["sa_score"] = sascorer.calculateScore(mol)
        except Exception:
            row["sa_score"] = np.nan

    # AMPC is a reference molecule, not a generated candidate; leave composite_score
    # and integrated_score as NaN so they are shown as "—" in the table and are not
    # used for better-than-AMPC comparisons.
    def _norm(val, mn, mx, higher_is_better=True):
        if pd.isna(val) or pd.isna(mn) or pd.isna(mx) or mx == mn:
            return 0.0
        if higher_is_better:
            return (val - mn) / (mx - mn)
        return (mx - val) / (mx - mn)

    row["composite_score"] = np.nan
    row["composite_score_norm"] = np.nan
    row["gnina_cnn_affinity_norm"] = _norm(
        row["gnina_cnn_affinity"],
        stats.get("gnina_cnn_affinity_min"), stats.get("gnina_cnn_affinity_max"),
        higher_is_better=True,
    )
    row["boltz_binding_confidence_norm"] = _norm(
        row["metric_binding_confidence"],
        stats.get("boltz_binding_confidence_min"), stats.get("boltz_binding_confidence_max"),
        higher_is_better=True,
    )
    row["vina_affinity_norm"] = _norm(
        row["vina_top_affinity"],
        stats.get("vina_top_affinity_min"), stats.get("vina_top_affinity_max"),
        higher_is_better=False,
    )

    dist = row["gnina_warhead_dist_min"]
    if pd.notna(dist):
        dist = min(float(dist), 2.5)
        row["warhead_geo_norm"] = 1.0 - (dist / 2.5)
    else:
        row["warhead_geo_norm"] = 0.0

    weights = {
        "admet_tier": 0.25,
        "gnina_cnn_affinity": 0.25,
        "vina_affinity": 0.15,
        "composite_score": 0.15,
        "boltz_binding_confidence": 0.10,
        "warhead_geometry": 0.05,
        "structural_alerts": 0.05,
    }
    row["integrated_score"] = (
        weights["admet_tier"] * row["admet_tier_norm"]
        + weights["gnina_cnn_affinity"] * row["gnina_cnn_affinity_norm"]
        + weights["vina_affinity"] * row["vina_affinity_norm"]
        + weights["composite_score"] * row["composite_score_norm"]
        + weights["boltz_binding_confidence"] * row["boltz_binding_confidence_norm"]
        + weights["warhead_geometry"] * row["warhead_geo_norm"]
        + weights["structural_alerts"] * row["structural_alert_score"]
    )

    # Align to target columns; missing columns get NaN / empty defaults
    aligned = {}
    for col in target_cols:
        aligned[col] = row.get(col, np.nan)
    ampc_df = pd.DataFrame([aligned])
    ampc_df["patent_risk_level"] = pd.Categorical(
        ampc_df["patent_risk_level"].fillna("High"), categories=RISK_ORDER, ordered=True
    )
    return ampc_df


def add_molecules(df):
    df = df.copy()
    df["mol"] = df["canonical_smiles"].apply(Chem.MolFromSmiles)
    df = df[df["mol"].notna()].copy()
    return df


# ---------------------------------------------------------------------------
# Plotting helpers
# ---------------------------------------------------------------------------
def save_fig(path, dpi=300):
    plt.tight_layout()
    plt.savefig(path, dpi=dpi, bbox_inches="tight")
    plt.close()


def plot_source_distribution(df, outdir):
    plt.figure(figsize=(8, 5))
    order = df["best_source"].value_counts().index
    sns.countplot(data=df, y="best_source", order=order, palette="tab10")
    plt.title("Top-500 candidates by generation source")
    plt.xlabel("Count")
    plt.ylabel("Source")
    save_fig(outdir / "source_distribution.png")


def plot_admet_tiers(df, outdir):
    counts = df["admet_tier_score"].fillna(0).astype(int).value_counts().sort_index()
    labels = [TIER_LABELS.get(i, str(i)) for i in counts.index]
    colors = ["#d62728", "#ff7f0e", "#ffdd44", "#2ca02c"][: len(counts)]

    # AMPC reference tier
    ampc = df[df["best_source"] == "AMPC_reference"]
    ampc_tier = int(ampc.iloc[0]["admet_tier_score"]) if not ampc.empty else 0
    ampc_label = TIER_LABELS.get(ampc_tier, str(ampc_tier))

    fig, ax = plt.subplots(figsize=(8, 5.5))
    bars = ax.bar(labels, counts.values, color=colors, edgecolor="black")
    ax.set_title("ADMET tier distribution (higher is better)", fontsize=13, fontweight="bold")
    ax.set_ylabel("Number of molecules", fontsize=12)
    ax.set_xlabel("")
    ax.tick_params(axis="both", labelsize=11)
    for bar, v in zip(bars, counts.values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 3, str(v),
                ha="center", va="bottom", fontsize=10)

    if ampc_label in labels:
        ampc_x = labels.index(ampc_label)
        ax.axvline(x=ampc_x, color="red", linestyle="--", linewidth=2)
        ax.text(ampc_x, ax.get_ylim()[1] * 0.95, "AMPC", color="red", ha="center", va="top",
                fontsize=10, fontweight="bold")

    save_fig(outdir / "admet_tier_distribution.png")


def plot_patent_risk_counts(df, outdir):
    counts = df["patent_risk_level"].value_counts().sort_index()
    colors = [RISK_PALETTE[r] for r in counts.index]

    fig, ax = plt.subplots(figsize=(9, 5.5))
    bars = ax.bar(counts.index.astype(str), counts.values, color=colors, edgecolor="black")
    ax.set_title("Patent risk level counts", fontsize=13, fontweight="bold")
    ax.set_ylabel("Number of molecules", fontsize=12)
    ax.set_xlabel("")
    ax.tick_params(axis="both", labelsize=11)
    for bar, v in zip(bars, counts.values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 3, str(v),
                ha="center", va="bottom", fontsize=10)
    save_fig(outdir / "patent_risk_counts.png")


def plot_patent_risk_by_source(df, outdir):
    sub = df[df["best_source"] != "AMPC_reference"].copy()
    sub["patent_risk_level"] = pd.Categorical(
        sub["patent_risk_level"], categories=RISK_ORDER, ordered=True
    )
    ctab = pd.crosstab(sub["best_source"], sub["patent_risk_level"])
    ctab = ctab.loc[ctab.sum(axis=1).sort_values(ascending=False).index]
    for lab in RISK_ORDER:
        if lab not in ctab.columns:
            ctab[lab] = 0
    ctab = ctab[RISK_ORDER]
    colors = [RISK_PALETTE[lab] for lab in RISK_ORDER]

    fig, ax = plt.subplots(figsize=(9, 5.5))
    ctab.plot(kind="barh", stacked=True, color=colors, ax=ax, edgecolor="white")
    ax.set_xlabel("Number of molecules", fontsize=12)
    ax.set_ylabel("Source", fontsize=12)
    ax.set_title("Patent risk distribution by generation source (n = 500)", fontsize=13, fontweight="bold")
    ax.tick_params(axis="both", labelsize=11)
    ax.legend(title="Patent risk level", loc="lower right", fontsize=10, title_fontsize=11)

    totals = ctab.sum(axis=1)
    for i, (idx, total) in enumerate(totals.items()):
        pct = total / totals.sum() * 100
        ax.text(total + 3, i, f"{int(total)} ({pct:.1f}%)", va="center", fontsize=10)
    save_fig(outdir / "patent_risk_by_source.png")


def plot_structural_alerts(df, outdir):
    sub = df[df["best_source"] != "AMPC_reference"].copy()

    # AMPC reference alert status
    ampc = df[df["best_source"] == "AMPC_reference"]
    if not ampc.empty:
        ampc_pains = bool(ampc.iloc[0]["pains_alert"])
        ampc_brenk = bool(ampc.iloc[0]["brenk_alert"])
    else:
        ampc_pains = False
        ampc_brenk = False

    def _alert_category(pains, brenk):
        if pains and brenk:
            return "Both"
        elif pains:
            return "PAINS only"
        elif brenk:
            return "BRENK only"
        return "No alerts"

    categories = ["No alerts", "PAINS only", "BRENK only", "Both"]
    colors = ["#2ca02c", "#d62728", "#ff7f0e", "#9467bd"]
    color_map = dict(zip(categories, colors))

    counts = [
        ((~sub["pains_alert"]) & (~sub["brenk_alert"])).sum(),
        (sub["pains_alert"] & (~sub["brenk_alert"])).sum(),
        ((~sub["pains_alert"]) & sub["brenk_alert"]).sum(),
        (sub["pains_alert"] & sub["brenk_alert"]).sum(),
    ]

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))

    # Left: overall counts
    ax = axes[0]
    bars = ax.bar(categories, counts, color=colors, edgecolor="black")
    ax.set_ylabel("Number of molecules", fontsize=12)
    ax.set_title("Structural alert categories (n = 500)", fontsize=12, fontweight="bold")
    ymax = max(counts) * 1.15
    ax.set_ylim(0, ymax)
    for bar, c in zip(bars, counts):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, height + 3, str(int(c)),
                ha="center", va="bottom", fontsize=10)

    ampc_cat = _alert_category(ampc_pains, ampc_brenk)
    ampc_x = categories.index(ampc_cat)
    ax.axvline(x=ampc_x, color="red", linestyle="--", linewidth=2)
    ax.text(ampc_x, ymax * 0.95, "AMPC", color="red", ha="center", va="top",
            fontsize=10, fontweight="bold")

    # Right: proportion by source, splitting any alert into PAINS and BRENK
    ax = axes[1]
    sub["alert_category"] = sub.apply(
        lambda row: _alert_category(row["pains_alert"], row["brenk_alert"]), axis=1
    )
    ctab = pd.crosstab(sub["best_source"], sub["alert_category"], normalize="index") * 100
    ctab = ctab.loc[ctab.sum(axis=1).sort_values(ascending=False).index]
    for cat in categories:
        if cat not in ctab.columns:
            ctab[cat] = 0.0
    ctab = ctab.reindex(columns=categories, fill_value=0.0)
    # Drop categories that are entirely zero to keep the legend clean
    ctab = ctab.loc[:, (ctab != 0).any(axis=0)]

    ctab.plot(kind="barh", stacked=True,
              color=[color_map[c] for c in ctab.columns],
              ax=ax, edgecolor="white")
    ax.set_xlabel("Percentage of molecules (%)", fontsize=12)
    ax.set_ylabel("Source", fontsize=12)
    ax.set_title("Alert category proportion by source", fontsize=12, fontweight="bold")
    ax.legend(loc="lower right")

    fig.suptitle("Structural alerts (PAINS / BRENK)", fontsize=14, fontweight="bold")
    save_fig(outdir / "structural_alerts.png")


def plot_property_distributions(df, outdir):
    cols = list(PROPERTY_COLS.keys())
    n = len(cols)
    fig, axes = plt.subplots(math.ceil(n / 3), 3, figsize=(14, 10))
    axes = axes.flatten()
    for ax, col in zip(axes, cols):
        if col not in df.columns:
            ax.set_visible(False)
            continue
        data = df[col].dropna()
        sns.histplot(data, kde=True, ax=ax, color="steelblue")
        ampc_val = _ampc_property_value(df, col)
        if ampc_val is not None:
            ax.axvline(ampc_val, color="red", linestyle="--", linewidth=2, label="AMPC")
            ax.legend(fontsize=8)
        ax.set_title(PROPERTY_COLS[col])
        ax.set_xlabel("")
    for ax in axes[n:]:
        ax.set_visible(False)
    fig.suptitle("Property distributions of the Top-500 candidates (AMPC reference in red)", y=1.02)
    save_fig(outdir / "property_distributions.png")


def _ampc_property_value(df, col):
    ampc = df[df["best_source"] == "AMPC_reference"]
    if not ampc.empty and col in ampc.columns and pd.notna(ampc[col].iloc[0]):
        return float(ampc[col].iloc[0])
    return None


def plot_properties_by_source(df, outdir):
    cols = list(PROPERTY_COLS.keys())
    fig, axes = plt.subplots(2, 3, figsize=(14, 10))
    axes = axes.flatten()
    for ax, col in zip(axes, cols):
        if col not in df.columns:
            ax.set_visible(False)
            continue
        sns.boxplot(data=df, x="best_source", y=col, ax=ax, hue="best_source", palette="tab10", legend=False)
        ampc_val = _ampc_property_value(df, col)
        if ampc_val is not None:
            ax.axhline(ampc_val, color="red", linestyle="--", linewidth=2, label="AMPC")
        ax.set_title(PROPERTY_COLS[col])
        ax.set_xlabel("")
        ax.set_ylabel("")
        ax.set_xticklabels(ax.get_xticklabels(), rotation=30, ha="right", fontsize=8)
        if ampc_val is not None:
            ax.legend(fontsize=8)
    fig.suptitle("Drug-like properties by generation source (AMPC reference in red)", y=1.02)
    save_fig(outdir / "properties_by_source.png")


def plot_admet_tier_by_source(df, outdir):
    df = df.copy()
    df["Tier"] = df["admet_tier_score"].map(TIER_LABELS)
    ctab = pd.crosstab(df["best_source"], df["Tier"])
    ordered_labels = [TIER_LABELS[i] for i in [3, 2, 1, 0]]
    for lab in ordered_labels:
        if lab not in ctab.columns:
            ctab[lab] = 0
    ctab = ctab[ordered_labels]
    colors = [TIER_COLORS[i] for i in [3, 2, 1, 0]]

    fig, ax = plt.subplots(figsize=(8, 5.5))
    ctab.plot(kind="barh", stacked=True, color=colors, ax=ax, edgecolor="white")
    ax.set_xlabel("Number of molecules", fontsize=12)
    ax.set_ylabel("Source", fontsize=12)
    ax.set_title("ADMET tier distribution by source (n = 501)", fontsize=13, fontweight="bold")
    ax.tick_params(axis="both", labelsize=11)
    ax.legend(title="ADMET tier", loc="lower right", fontsize=10, title_fontsize=11)
    for i, (idx, row) in enumerate(ctab.iterrows()):
        total = row.sum()
        ax.text(total + 2, i, str(int(total)), va="center", fontsize=10)
    save_fig(outdir / "admet_tier_by_source.png")


# ---------------------------------------------------------------------------
# BoltzMol-1 figures
# ---------------------------------------------------------------------------
def _boltz_draw_box(ax, x, y, w, h, title, facecolor, subtitle=None, fontsize=10):
    box = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.15",
        facecolor=facecolor,
        edgecolor="#333333",
        linewidth=1.5,
    )
    ax.add_patch(box)
    if subtitle:
        ax.text(x + w / 2, y + h / 2 + 0.12, title,
                ha="center", va="center", fontsize=fontsize, fontweight="bold", color="#212529")
        ax.text(x + w / 2, y + h / 2 - 0.14, subtitle,
                ha="center", va="center", fontsize=fontsize - 1.5, color="#495057")
    else:
        ax.text(x + w / 2, y + h / 2, title,
                ha="center", va="center", fontsize=fontsize, fontweight="bold", color="#212529")


def _boltz_draw_arrow(ax, x1, y1, x2, y2):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="->", color="#6c757d", lw=1.8))


def plot_boltz_workflow(outdir):
    fig, ax = plt.subplots(figsize=(12, 5.5))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 5)
    ax.axis("off")

    inputs = [
        (0.2, 3.0, 1.9, 1.1, "AMPC", "#e3f2fd", "mol0000"),
        (2.4, 3.0, 1.9, 1.1, "Top 500", "#e8f5e9", "candidates"),
        (4.6, 3.0, 2.2, 1.1, "BoltzMol-1", "#fce4ec", "default filter"),
        (7.2, 3.0, 2.0, 1.1, "Initial output", "#fff3e0", "468 / 501"),
        (9.5, 3.0, 2.0, 1.1, "Retry", "#ffebee", "disabled filter\n33 / 33"),
    ]
    for x, y, w, h, t, c, s in inputs:
        _boltz_draw_box(ax, x, y, w, h, t, c, s, fontsize=9)

    bottom = [
        (1.5, 0.6, 2.4, 1.1, "Merge", "#e1f5fe", "501 structures"),
        (4.4, 0.6, 2.6, 1.1, "Confidence metrics", "#f3e5f5", "pLDDT / ipTM / binding"),
        (7.4, 0.6, 2.8, 1.1, "Integrated scoring", "#fff8e1", "visualization\ncross-validation"),
    ]
    for x, y, w, h, t, c, s in bottom:
        _boltz_draw_box(ax, x, y, w, h, t, c, s, fontsize=9)

    for i in range(len(inputs) - 1):
        x1 = inputs[i][0] + inputs[i][2]
        x2 = inputs[i + 1][0]
        _boltz_draw_arrow(ax, x1, 3.55, x2, 3.55)

    retry_center_x = inputs[-1][0] + inputs[-1][2] / 2
    merge_center_x = bottom[0][0] + bottom[0][2] / 2
    _boltz_draw_arrow(ax, retry_center_x, 3.0, retry_center_x, 2.5)
    ax.plot([retry_center_x, merge_center_x], [2.5, 2.5], color="#6c757d", lw=1.5)
    _boltz_draw_arrow(ax, merge_center_x, 2.5, merge_center_x, bottom[0][1] + bottom[0][3])

    for i in range(len(bottom) - 1):
        x1 = bottom[i][0] + bottom[i][2]
        x2 = bottom[i + 1][0]
        _boltz_draw_arrow(ax, x1, 1.15, x2, 1.15)

    ax.text(6.0, 2.15, "33 molecules filtered by Boltz internal SMARTS catalog → retried with filter disabled",
            ha="center", va="center", fontsize=9, color="#6c757d", style="italic")

    ax.set_title("BoltzMol-1 structural confidence workflow", fontsize=14, fontweight="bold", pad=15)
    save_fig(outdir / "boltz_workflow.png")


def plot_boltz_distribution(outdir):
    project_root = outdir.parent
    all_path = project_root / "boltz" / "output" / "boltzmol_all_results.csv"
    retry_path = project_root / "boltz" / "output" / "boltzmol_retry_results.csv"
    if not all_path.is_file():
        return
    all_results = pd.read_csv(all_path)
    retry_ids = set()
    if retry_path.is_file():
        retry_ids = set(pd.read_csv(retry_path)["external_id"].astype(str))
    all_results["retried"] = all_results["external_id"].astype(str).isin(retry_ids)

    ampc = all_results[all_results["external_id"] == "mol0000"]
    ampc_binding = ampc["metric_binding_confidence"].iloc[0] if not ampc.empty else None
    ampc_struct = ampc["metric_structure_confidence"].iloc[0] if not ampc.empty else None

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    ax = axes[0]
    ax.hist(all_results.loc[~all_results["retried"], "metric_binding_confidence"],
            bins=25, color="steelblue", edgecolor="black", alpha=0.8, label="Initial pass (468)")
    ax.hist(all_results.loc[all_results["retried"], "metric_binding_confidence"],
            bins=25, color="coral", edgecolor="black", alpha=0.8, label="Retried (33)")
    if ampc_binding is not None:
        ax.axvline(ampc_binding, color="red", linestyle="--", linewidth=2, label=f"AMPC ({ampc_binding:.3f})")
    ax.set_xlabel("Binding confidence", fontsize=12)
    ax.set_ylabel("Number of molecules", fontsize=12)
    ax.set_title("Binding confidence distribution", fontsize=12, fontweight="bold")
    ax.legend(fontsize=9)

    ax = axes[1]
    ax.hist(all_results.loc[~all_results["retried"], "metric_structure_confidence"],
            bins=25, color="steelblue", edgecolor="black", alpha=0.8, label="Initial pass (468)")
    ax.hist(all_results.loc[all_results["retried"], "metric_structure_confidence"],
            bins=25, color="coral", edgecolor="black", alpha=0.8, label="Retried (33)")
    if ampc_struct is not None:
        ax.axvline(ampc_struct, color="red", linestyle="--", linewidth=2, label=f"AMPC ({ampc_struct:.3f})")
    ax.set_xlabel("Structure confidence", fontsize=12)
    ax.set_ylabel("Number of molecules", fontsize=12)
    ax.set_title("Structure confidence distribution", fontsize=12, fontweight="bold")
    ax.legend(fontsize=9)

    fig.suptitle("BoltzMol-1 confidence distributions (n = 501)", fontsize=14, fontweight="bold")
    save_fig(outdir / "boltz_distribution.png")


def plot_score_vs_risk(df, outdir):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    sns.scatterplot(
        data=df,
        x="gnina_cnn_affinity",
        y="integrated_score",
        hue="patent_risk_level",
        palette=RISK_PALETTE,
        alpha=0.8,
        ax=axes[0],
    )
    axes[0].set_title("Integrated score vs. GNINA CNN affinity")
    axes[0].set_xlabel("GNINA CNN affinity (higher = stronger predicted binding)")

    sns.boxplot(
        data=df,
        x="patent_risk_level",
        y="integrated_score",
        order=RISK_ORDER,
        palette=RISK_PALETTE,
        ax=axes[1],
    )
    axes[1].set_title("Integrated score by patent risk")
    axes[1].set_xlabel("Patent risk level")
    save_fig(outdir / "score_vs_patent_risk.png")


def plot_correlation_heatmap(df, outdir):
    avail = [c for c in KEY_METRICS if c in df.columns]
    sub = df[avail].copy()
    if "vina_top_affinity" in sub.columns:
        sub["vina_top_affinity"] = -sub["vina_top_affinity"]
    if "patent_risk_level" in df.columns:
        sub["patent_risk_level"] = df["patent_risk_level"].cat.codes

    corr = sub.corr(method="spearman")

    rename = {
        "vina_top_affinity": "-Vina affinity",
        "gnina_cnn_affinity": "GNINA CNN affinity",
        "gnina_affinity": "GNINA affinity",
        "gnina_warhead_dist_min": "GNINA warhead distance",
        "metric_binding_confidence": "Boltz binding confidence",
        "metric_structure_confidence": "Boltz structure confidence",
        "composite_score": "Composite score",
        "composite_score_norm": "Composite score (norm)",
        "integrated_score": "Integrated score",
        "admet_tier_score": "ADMET tier",
        "admet_tier_norm": "ADMET tier (norm)",
        "qed": "QED",
        "sa_score": "SA score",
        "tanimoto_to_ampc": "Tanimoto to AMPC",
        "mw": "MW",
        "logp": "LogP",
        "tpsa": "TPSA",
        "hbd": "HBD",
        "hba": "HBA",
        "rotb": "Rotatable bonds",
        "n_chiral": "N chiral centers",
        "warhead_geo_norm": "Warhead geometry (norm)",
        "structural_alert_score": "Structural alert score",
        "alert_count": "Alert count",
        "patent_risk_level": "Patent risk level",
    }
    rename = {k: v for k, v in rename.items() if k in corr.columns}
    corr = corr.rename(columns=rename, index=rename)

    n = len(corr)
    figsize = (max(10, 0.65 * n), max(8, 0.6 * n))
    plt.figure(figsize=figsize)
    sns.heatmap(
        corr,
        annot=True,
        fmt=".2f",
        cmap="RdBu_r",
        center=0,
        vmin=-1,
        vmax=1,
        square=True,
        linewidths=0.5,
    )
    plt.xticks(rotation=45, ha="right", fontsize=10)
    plt.yticks(rotation=0, fontsize=10)
    plt.title("Spearman correlation across scoring metrics, ADMET properties and structural features")
    save_fig(outdir / "correlation_heatmap.png")


def _alert_category(pains, brenk):
    if pains and brenk:
        return "Both"
    elif pains:
        return "PAINS only"
    elif brenk:
        return "BRENK only"
    return "No alerts"


ALERT_CATEGORY_COLORS = {
    "No alerts": "#2ca02c",
    "PAINS only": "#d62728",
    "BRENK only": "#ff7f0e",
    "Both": "#9467bd",
}


def plot_tsne_projection(df, outdir):
    fps = []
    valid_idx = []
    for i, row in df.iterrows():
        m = row["mol"]
        if m is None:
            continue
        fp = rdMolDescriptors.GetMorganFingerprintAsBitVect(m, 2, nBits=2048)
        fps.append(np.array(fp, dtype=np.float32))
        valid_idx.append(i)
    if len(fps) < 10:
        return None
    X = np.vstack(fps)
    perplexity = min(30, len(fps) - 1)
    tsne = TSNE(n_components=2, perplexity=perplexity, random_state=42, init="pca")
    coords = tsne.fit_transform(X)

    proj = pd.DataFrame(coords, columns=["t-SNE 1", "t-SNE 2"], index=valid_idx)

    # Attach columns needed for the combined overview panels
    extra_cols = [
        "best_source", "patent_risk_level", "integrated_score", "composite_score",
        "vina_top_affinity", "gnina_cnn_affinity", "admet_tier_score",
        "metric_binding_confidence", "pains_alert", "brenk_alert",
    ]
    for col in extra_cols:
        if col in df.columns:
            proj[col] = df.loc[valid_idx, col].values

    if "pains_alert" in proj.columns and "brenk_alert" in proj.columns:
        proj["alert_category"] = proj.apply(
            lambda row: _alert_category(bool(row["pains_alert"]), bool(row["brenk_alert"])), axis=1
        )

    panels = [
        ("best_source", "Generation source", None),
        ("composite_score", "Composite score", "plasma"),
        ("integrated_score", "Integrated score", "viridis"),
        ("alert_category", "Structural alerts", None),
        ("vina_top_affinity", "Vina affinity (kcal/mol)", "viridis_r"),
        ("gnina_cnn_affinity", "GNINA CNN affinity", "viridis"),
        ("admet_tier_score", "ADMET tier", None),
        ("metric_binding_confidence", "BoltzMol-1 confidence", "cividis"),
        ("patent_risk_level", "Patent risk", None),
    ]

    fig, axes = plt.subplots(3, 3, figsize=(18, 16))
    axes = axes.flatten()

    for ax, (col, title, cmap) in zip(axes, panels):
        if col not in proj.columns:
            ax.set_visible(False)
            continue
        valid = proj[col].notna()
        if valid.sum() == 0:
            ax.set_visible(False)
            continue

        if col == "best_source":
            sns.scatterplot(
                data=proj.loc[valid],
                x="t-SNE 1", y="t-SNE 2",
                hue="best_source", palette="tab10",
                alpha=0.8, ax=ax, s=45,
            )
            ax.legend(title=title, loc="best", fontsize="small")
        elif col == "patent_risk_level":
            sns.scatterplot(
                data=proj.loc[valid],
                x="t-SNE 1", y="t-SNE 2",
                hue="patent_risk_level", hue_order=RISK_ORDER,
                palette=RISK_PALETTE,
                alpha=0.8, ax=ax, s=45,
            )
            ax.legend(title=title, loc="best", fontsize="small")
        elif col == "alert_category":
            for cat, color in ALERT_CATEGORY_COLORS.items():
                mask = valid & (proj[col] == cat)
                if mask.any():
                    ax.scatter(
                        proj.loc[mask, "t-SNE 1"],
                        proj.loc[mask, "t-SNE 2"],
                        c=color, label=cat, s=45, alpha=0.8,
                    )
            ax.legend(title=title, loc="best", fontsize="small")
        elif col == "admet_tier_score":
            for tier, color in TIER_COLORS.items():
                mask = valid & (proj[col] == tier)
                if mask.any():
                    ax.scatter(
                        proj.loc[mask, "t-SNE 1"],
                        proj.loc[mask, "t-SNE 2"],
                        c=color, label=TIER_LABELS.get(tier, str(tier)),
                        s=45, alpha=0.8,
                    )
            ax.legend(title=title, loc="best", fontsize="small")
        else:
            sc = ax.scatter(
                proj.loc[valid, "t-SNE 1"],
                proj.loc[valid, "t-SNE 2"],
                c=proj.loc[valid, col],
                cmap=cmap,
                s=45,
                alpha=0.8,
            )
            plt.colorbar(sc, ax=ax)

        ax.set_title(f"Colored by {title}")
        ax.set_xlabel("t-SNE 1")
        ax.set_ylabel("t-SNE 2")

    for ax in axes[len(panels):]:
        ax.set_visible(False)

    plt.tight_layout()
    save_fig(outdir / "tsne_projection.png")
    plt.close(fig)
    return proj


def _tsne_grid(proj, cols, outdir, filename, ncols=3, figwidth=16):
    """Plot a grid of t-SNE projections colored by one or more columns."""
    n = len(cols)
    if n == 0:
        return
    nrows = math.ceil(n / ncols)
    fig, axes = plt.subplots(nrows, ncols, figsize=(figwidth, 5 * nrows))
    axes = np.atleast_1d(axes).flatten()

    for ax, (col, title, cmap, discrete) in zip(axes, cols):
        if col not in proj.columns:
            ax.set_visible(False)
            continue
        valid = proj[col].notna()
        if valid.sum() == 0:
            ax.set_visible(False)
            continue

        if discrete:
            for tier, color in TIER_COLORS.items():
                mask = valid & (proj[col] == tier)
                if mask.any():
                    ax.scatter(
                        proj.loc[mask, "t-SNE 1"],
                        proj.loc[mask, "t-SNE 2"],
                        c=color,
                        label=TIER_LABELS.get(tier, str(tier)),
                        s=45,
                        alpha=0.8,
                    )
            ax.legend(title=title, loc="best", fontsize="small")
            ax.set_title(f"Colored by {title}")
        else:
            sc = ax.scatter(
                proj.loc[valid, "t-SNE 1"],
                proj.loc[valid, "t-SNE 2"],
                c=proj.loc[valid, col],
                cmap=cmap,
                s=45,
                alpha=0.8,
            )
            ax.set_title(f"Colored by {title}")
            plt.colorbar(sc, ax=ax)

        ax.set_xlabel("t-SNE 1")
        ax.set_ylabel("t-SNE 2")

    for ax in axes[n:]:
        ax.set_visible(False)

    plt.tight_layout()
    save_fig(outdir / filename)
    plt.close(fig)


def plot_tsne_properties(df, outdir):
    """Additional t-SNE projections colored by molecular properties."""
    proj = plot_tsne_projection(df, outdir)
    if proj is None or proj.empty:
        return

    property_cols = [
        ("mw", "Molecular weight (Da)", "cividis", False),
        ("logp", "LogP", "viridis", False),
        ("tpsa", "TPSA (Å²)", "magma", False),
        ("qed", "QED drug-likeness", "viridis", False),
        ("sa_score", "SA score", "inferno", False),
        ("tanimoto_to_ampc", "Tanimoto to AMPC", "viridis", False),
    ]

    needed_cols = [c for c, *_ in property_cols if c in df.columns and c not in proj.columns]
    if needed_cols:
        proj = proj.join(df[needed_cols], how="left")

    _tsne_grid(proj, property_cols, outdir, "tsne_properties.png")


def draw_top_molecules(df, outdir, n=25):
    top = df.nsmallest(n, "overall_rank").copy()
    mols = []
    legends = []
    for _, row in top.iterrows():
        m = row["mol"]
        if m is None:
            continue
        label = f"#{int(row['overall_rank'])}  {row['best_source']}\n"
        label += f"score={row['integrated_score']:.3f}  risk={row['patent_risk_level']}"
        mols.append(m)
        legends.append(label)

    if not mols:
        return None

    img = Draw.MolsToGridImage(
        mols,
        molsPerRow=5,
        subImgSize=(350, 350),
        legends=legends,
        useSVG=True,
    )
    svg_path = outdir / "top_molecules_grid.svg"
    with open(svg_path, "w") as f:
        f.write(img)

    img_png = Draw.MolsToGridImage(
        mols,
        molsPerRow=5,
        subImgSize=(350, 350),
        legends=legends,
    )
    png_path = outdir / "top_molecules_grid.png"
    img_png.save(png_path)
    return svg_path, png_path


def draw_ampc_reference(ampc_smiles, outdir):
    if not ampc_smiles:
        return None
    m = Chem.MolFromSmiles(ampc_smiles)
    if m is None:
        return None
    AllChem.Compute2DCoords(m)

    warhead = Chem.MolFromSmarts("N#CC(=C(N)O)")
    match = m.GetSubstructMatch(warhead)
    if not match:
        # Fallback: draw without highlight
        drawer = rdMolDraw2D.MolDraw2DSVG(700, 450)
        drawer.DrawMolecule(m, legend="AMPC reference")
        drawer.FinishDrawing()
        svg = drawer.GetDrawingText()
        svg_path = outdir / "ampc_reference_highlighted.svg"
        with open(svg_path, "w") as f:
            f.write(svg)
        return svg_path

    atoms = list(match)
    bonds = [
        b.GetIdx()
        for i in range(len(atoms))
        for j in range(i + 1, len(atoms))
        for b in (m.GetBondBetweenAtoms(atoms[i], atoms[j]),)
        if b is not None
    ]

    # SVG (web-first, scalable)
    drawer = rdMolDraw2D.MolDraw2DSVG(700, 450)
    opts = drawer.drawOptions()
    opts.highlightColour = (1.0, 0.25, 0.25)
    opts.fillHighlights = True
    opts.highlightRadius = 0.22
    opts.legendFontSize = 16
    drawer.DrawMolecule(
        m,
        highlightAtoms=atoms,
        highlightBonds=bonds,
        legend="AMPC reference (enaminonitrile warhead highlighted)",
    )
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    svg_path = outdir / "ampc_reference_highlighted.svg"
    with open(svg_path, "w") as f:
        f.write(svg)

    return svg_path


def render_molecule_images(df, size=(180, 135)):
    """Render each molecule in `df` as an inline base64 SVG image.

    Returns a dict mapping molecule idx to a data URI string. Missing or
    invalid molecules map to an empty string.
    """
    images = {}
    for _, row in df.iterrows():
        mol = row.get("mol")
        idx = row.get("idx")
        if mol is None or pd.isna(idx):
            images[idx] = ""
            continue
        try:
            drawer = rdMolDraw2D.MolDraw2DSVG(size[0], size[1])
            drawer.DrawMolecule(mol)
            drawer.FinishDrawing()
            svg = drawer.GetDrawingText()
            b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
            images[idx] = f"data:image/svg+xml;base64,{b64}"
        except Exception:
            images[idx] = ""
    return images


# ---------------------------------------------------------------------------
# New project-level figures
# ---------------------------------------------------------------------------
def plot_filter_funnel(outdir):
    """Show the reduction of candidate numbers through the filtering stages."""
    stages = [
        "After hard\nfilters",
        "Canonical\ndeduplication",
        "Cluster +\nsource quota",
        "Top-500",
    ]
    counts = [1400398, 1018881, 558679, 500]

    fig, ax = plt.subplots(figsize=(9, 6))
    bars = ax.barh(stages, counts, color=["#4caf50", "#2196f3", "#ff9800", "#f44336"], edgecolor="black")
    ax.set_xscale("log")
    ax.set_xlabel("Number of molecules (log scale)")
    ax.set_title("Candidate pool reduction through the filtering funnel")
    ax.invert_yaxis()
    for bar, count in zip(bars, counts):
        ax.text(count * 1.2, bar.get_y() + bar.get_height() / 2, f"{count:,}",
                va="center", fontsize=11, fontweight="bold")
    save_fig(outdir / "filter_funnel.png")


def plot_source_balance(clustered_path, top500_path, outdir):
    """Before/after source-quota balance for the Top 500 candidates."""
    clustered = pd.read_csv(clustered_path)
    before_counts = (
        clustered.sort_values("composite_score", ascending=False)
        .head(500)["best_source"]
        .value_counts()
        .sort_index()
    )

    top500 = pd.read_csv(top500_path)
    after_counts = top500["best_source"].value_counts().sort_index()

    # Unified source order and colors
    all_sources = sorted(set(before_counts.index) | set(after_counts.index))
    colors = plt.cm.tab10.colors[: len(all_sources)]
    color_map = dict(zip(all_sources, colors))

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.5))

    def draw_pie(ax, counts, title, legend_side="right"):
        labels = counts.index.tolist()
        sizes = counts.values
        total = sizes.sum()
        cols = [color_map[s] for s in labels]
        wedges, texts, autotexts = ax.pie(
            sizes,
            colors=cols,
            autopct=lambda pct: f"{pct:.1f}%\n({int(round(pct * total / 100))})",
            startangle=90,
            counterclock=False,
            wedgeprops=dict(edgecolor="white", linewidth=1.5),
            textprops=dict(fontsize=9),
            pctdistance=0.65,
        )
        for autotext in autotexts:
            autotext.set_fontsize(8)
            autotext.set_fontweight("bold")
        ax.set_title(title, fontsize=13, fontweight="bold", pad=10)

        # Place legend outside the pie to avoid overlapping labels
        if legend_side == "right":
            ax.legend(wedges, labels, title="Source", loc="center left",
                      bbox_to_anchor=(0.95, 0.5), fontsize=8, title_fontsize=9)
        else:
            ax.legend(wedges, labels, title="Source", loc="center right",
                      bbox_to_anchor=(0.05, 0.5), fontsize=8, title_fontsize=9)

    draw_pie(ax1, before_counts, f"Before balance (n = {before_counts.sum()})", legend_side="left")
    draw_pie(ax2, after_counts, f"After balance (n = {after_counts.sum()})", legend_side="right")

    # Arrow + balance condition in figure coordinates
    arrow = FancyArrowPatch(
        (0.47, 0.5), (0.53, 0.5),
        transform=fig.transFigure,
        arrowstyle="->",
        mutation_scale=25,
        color="#6c757d",
        linewidth=2,
    )
    fig.patches.append(arrow)
    fig.text(
        0.5, 0.60, "Source quota balance",
        ha="center", va="center", fontsize=11, fontweight="bold", color="#212529",
    )
    fig.text(
        0.5, 0.52, "min 20 / source\nmax 300 / source",
        ha="center", va="center", fontsize=9, color="#495057",
    )

    fig.suptitle(
        "Effect of source quotas on the Top-500 candidate pool",
        fontsize=15, fontweight="bold", y=0.98,
    )
    save_fig(outdir / "source_balance.png")


def plot_model_variants(outdir):
    """Pipeline-style diagram for molecular generation strategies."""
    fig, ax = plt.subplots(figsize=(12, 7))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10)
    ax.axis("off")

    def draw_box(x, y, w, h, title, facecolor, edgecolor="#ff9800", subtitle=None):
        box = FancyBboxPatch(
            (x, y), w, h,
            boxstyle="round,pad=0.02,rounding_size=0.15",
            facecolor=facecolor,
            edgecolor=edgecolor,
            linewidth=1.8,
        )
        ax.add_patch(box)
        if subtitle:
            ax.text(
                x + w / 2, y + h / 2 + 0.12, title,
                ha="center", va="center", fontsize=10.5, fontweight="bold", color="#212529",
            )
            ax.text(
                x + w / 2, y + h / 2 - 0.18, subtitle,
                ha="center", va="center", fontsize=8, color="#495057",
            )
        else:
            ax.text(
                x + w / 2, y + h / 2, title,
                ha="center", va="center", fontsize=11, fontweight="bold", color="#212529",
            )

    def draw_arrow(x1, y1, x2, y2):
        ax.annotate(
            "", xy=(x2, y2), xytext=(x1, y1),
            arrowprops=dict(arrowstyle="->", color="#6c757d", lw=1.8),
        )

    # ------------------------------------------------------------------
    # Left column: RL pipeline
    # ------------------------------------------------------------------
    x_rl = 0.8
    w_col = 4.4
    h_box = 0.75

    # Transfer-learning anchor
    draw_box(x_rl, 8.55, w_col, h_box,
             "Transfer learning", "#fff3e0")

    # Grouping rectangle for the four parallel RL variants
    group = FancyBboxPatch(
        (x_rl - 0.2, 4.55), w_col + 0.4, 3.55,
        boxstyle="round,pad=0.02,rounding_size=0.2",
        facecolor="#fff8e1",
        edgecolor="#ffcc80",
        linewidth=1.5,
        linestyle="--",
    )
    ax.add_patch(group)
    ax.text(x_rl + w_col / 2, 7.8, "Parallel RL variants",
            ha="center", va="center", fontsize=11, fontweight="bold", color="#e65100")

    # Four RL variants (no arrows between them)
    variants = [
        ("RL varA", "#ffe0b2"),
        ("RL varB", "#ffcc80"),
        ("RL varC", "#ffb74d"),
        ("RL varD", "#ff9800"),
    ]
    x_left = x_rl + 0.15
    x_right = x_rl + w_col / 2 + 0.05
    y_top = 6.85
    y_bot = 5.15
    box_w = (w_col / 2) - 0.25
    for i, (title, color) in enumerate(variants):
        x = x_left if i % 2 == 0 else x_right
        y = y_top if i < 2 else y_bot
        draw_box(x, y, box_w, h_box, title, color)

    # ------------------------------------------------------------------
    # Right column: Mol2Mol pipeline
    # ------------------------------------------------------------------
    x_m2m = 6.8
    m2m_steps = [
        ("5 Mol2Mol priors", "#e1f5fe"),
        ("mol2mol_similarity.prior", "#b3e5fc"),
        ("500k production", "#81d4fa"),
        ("Mol2Mol output", "#4fc3f7"),
    ]
    y = 8.55
    for title, color in m2m_steps:
        draw_box(x_m2m, y, w_col, h_box, title, color, edgecolor="#0288d1")
        if title != m2m_steps[-1][0]:
            draw_arrow(x_m2m + w_col / 2, y, x_m2m + w_col / 2, y - 0.40)
        y -= 1.30

    # Column labels
    ax.text(x_rl + w_col / 2, 9.7, "RL pipeline",
            ha="center", va="center", fontsize=13, fontweight="bold", color="#e65100")
    ax.text(x_m2m + w_col / 2, 9.7, "Mol2Mol pipeline",
            ha="center", va="center", fontsize=13, fontweight="bold", color="#01579b")

    ax.set_title("Molecular generation strategies used in the project",
                 fontsize=15, fontweight="bold", pad=15, y=0.98)
    save_fig(outdir / "model_variants.png")


def generate_pipeline_html() -> str:
    """Return a responsive HTML/CSS pipeline diagram."""
    return """
    <div class="pipeline">
      <div class="pipe-stage">
        <div class="pipe-box hypothesis">
          <strong>Hypothesis</strong>
          <small>AMPC enaminonitrile warhead can engage TFF3 Cys57</small>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-dashed">
          <span class="pipe-group-title">REINVENT4</span>
          <div class="pipe-col">
            <div class="pipe-box gen">
              <strong>Reinforcement Learning (RL)</strong>
              <small>scaffold hopping</small>
            </div>
            <div class="pipe-box gen">
              <strong>Mol2Mol</strong>
              <small>side-chain modification</small>
            </div>
          </div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-col">
          <div class="pipe-box filter">
            <strong>Hard filters</strong>
            <small>1,400,398</small>
          </div>
          <div class="pipe-box filter">
            <strong>Deduplication</strong>
            <small>1,018,881</small>
          </div>
          <div class="pipe-box filter">
            <strong>Cluster + quota</strong>
            <small>558,679</small>
          </div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-box top500">
          <strong>Top 500</strong>
        </div>
      </div>

      <div class="pipe-arrow down">↓</div>

      <div class="pipe-stage">
        <div class="pipe-dashed integrated">
          <span class="pipe-group-title integrated">Integrated ranking</span>
          <div class="pipe-col eval">
            <div class="pipe-box eval">
              <strong>Structural alerts</strong>
              <small>PAINS / BRENK</small>
            </div>
            <div class="pipe-box eval">
              <strong>AutoDock Vina</strong>
              <small>non-covalent</small>
            </div>
            <div class="pipe-box eval">
              <strong>GNINA</strong>
              <small>covalent</small>
            </div>
            <div class="pipe-box eval">
              <strong>ADMETlab 3.0</strong>
            </div>
            <div class="pipe-box eval">
              <strong>BoltzMol-1</strong>
            </div>
            <div class="pipe-box eval">
              <strong>Patent screen</strong>
            </div>
          </div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-box output">
          <strong>Top candidates</strong>
          <small>for synthesis</small>
        </div>
      </div>
    </div>
    """


# ---------------------------------------------------------------------------
# HTML report
# ---------------------------------------------------------------------------
def build_html(outdir, figures, full_table, molecule_images, summary, pipeline_html, source_rows):
    def _fmt(val, fmt=".2f", na="—"):
        if pd.isna(val):
            return na
        if fmt == "int":
            return str(int(val))
        return f"{val:{fmt}}"

    def _alert_cell(row):
        if row.get("any_alert"):
            pains = str(row.get("pains_names", "") or "")
            brenk = str(row.get("brenk_names", "") or "")
            details = f"{pains[:20]}{';' if pains and brenk else ''}{brenk[:20]}"
            return f"⚠ {int(row.get('alert_count', 0))} ({details})"
        return "✓ None"

    full_rows = ""
    # Sort: AMPC reference first (overall_rank == 0), then candidates by rank
    table_sorted = full_table.sort_values("overall_rank", ascending=True, na_position="last")
    for _, row in table_sorted.iterrows():
        idx = row.get("idx")
        is_ampc = row["best_source"] == "AMPC_reference"
        img_src = molecule_images.get(idx, "")
        img_html = f'<img src="{img_src}" alt="mol" class="mol-img" style="width:120px;" loading="lazy" onerror="this.style.display=\'none\'"&gt;' if img_src else "—"
        rank_label = "AMPC" if is_ampc else _fmt(row["overall_rank"], "int")
        if row.get("boltz_retry"):
            rank_label += "*"
        vina_val = row.get("vina_top_affinity")
        vina_display = "N/A (ref)" if is_ampc and pd.isna(vina_val) else _fmt(vina_val)

        def _dv(val):
            return f'data-value="{val}"' if pd.notna(val) else 'data-value=""'

        chiral_class = " chiral" if row.get("n_chiral", 0) > 0 else ""
        full_rows += f"""
        <tr class="{'ampc-row' if is_ampc else ''}">
          <td class="rank{chiral_class}" {_dv(row.get('overall_rank'))}>{rank_label}</td>
          <td class="structure">{img_html}</td>
          <td class="numeric mw" {_dv(row.get('mw'))}>{_fmt(row['mw'])}</td>
          <td class="source">{row['best_source']}</td>
          <td class="numeric gnina" {_dv(row.get('gnina_cnn_affinity'))}>{_fmt(row['gnina_cnn_affinity'])}</td>
          <td class="numeric vina" {_dv(row.get('vina_top_affinity'))}>{vina_display}</td>
          <td class="numeric admet" {_dv(row.get('admet_tier_score'))}>{_fmt(row['admet_tier_score'], 'int')}</td>
          <td class="numeric boltz" {_dv(row.get('metric_binding_confidence'))}>{_fmt(row['metric_binding_confidence'])}</td>
          <td class="patent">{row['patent_risk_level']}</td>
          <td class="alerts">{_alert_cell(row)}</td>
          <td class="numeric sa" {_dv(row.get('sa_score'))}>{_fmt(row['sa_score'])}</td>
          <td class="numeric composite" {_dv(row.get('composite_score'))}>{_fmt(row['composite_score'])}</td>
          <td class="numeric integrated" {_dv(row.get('integrated_score'))}>{_fmt(row['integrated_score'])}</td>
        </tr>
        """

    TABLE_SORT_SCRIPT = """
  <script>
  (function() {
    const table = document.querySelector('.candidate-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const headers = Array.from(table.querySelectorAll('thead th'));
    let rows = Array.from(tbody.querySelectorAll('tr'));
    const ampcRow = rows.find(r => r.classList.contains('ampc-row'));
    const filterStatus = document.getElementById('filter-status');
    let menu = null;
    let currentSort = { idx: 0, dir: 'asc' };
    const activeFilters = {};

    const CATEGORICAL_NAMES = ['Source', 'Patent risk', 'Structural alerts'];

    const colConfig = {};
    headers.forEach((th, i) => {
      const name = th.textContent.trim();
      if (name === 'GNINA CNN' || name === 'Boltz confidence' || name === 'ADMET tier' || name === 'Composite score' || name === 'Integrated score' || name === 'MW (Da)') {
        colConfig[i] = { higherBetter: true, numeric: true, name: name };
      } else if (name === 'Vina (kcal/mol)' || name === 'SA score') {
        colConfig[i] = { higherBetter: false, numeric: true, name: name };
      } else if (name === 'Rank') {
        colConfig[i] = { higherBetter: false, numeric: false, name: name };  // sort only, no heatmap
      }
    });

    function isCategorical(idx) {
      return CATEGORICAL_NAMES.includes(headers[idx].textContent.trim());
    }

    function getValue(row, idx) {
      const td = row.children[idx];
      if (!td) return NaN;
      const dv = td.getAttribute('data-value');
      if (dv !== null && dv !== '') return parseFloat(dv);
      const txt = td.textContent.trim();
      if (txt === '—' || txt === '' || txt === 'N/A (ref)') return NaN;
      const n = parseFloat(txt);
      return isNaN(n) ? txt : n;
    }

    function getRankColor(t) {
      // t in [0, 1]; 0 = blue (bad), 0.5 = white, 1 = red (good)
      let r, g, b;
      if (t >= 0.5) {
        const p = (t - 0.5) * 2;  // 0 at white, 1 at red
        r = Math.round(255 - 35 * p);
        g = Math.round(255 - 205 * p);
        b = Math.round(255 - 205 * p);
      } else {
        const p = t * 2;  // 0 at blue, 1 at white
        r = Math.round(50 + 205 * p);
        g = Math.round(100 + 155 * p);
        b = Math.round(220 + 35 * p);
      }
      return `rgb(${r}, ${g}, ${b})`;
    }

    function compare(a, b, idx, cfg) {
      const th = headers[idx];
      const name = th.textContent.trim();
      const va = getValue(a, idx);
      const vb = getValue(b, idx);

      // Categorical sorts with a fixed order
      if (name === 'Patent risk') {
        const order = ["Low", "Low-Medium", "Medium", "Marginal", "High"];
        const ia = order.indexOf(String(va));
        const ib = order.indexOf(String(vb));
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
      if (name === 'Structural alerts') {
        const na = String(va).startsWith('✓') || String(va).includes('None') ? 0 : 1;
        const nb = String(vb).startsWith('✓') || String(vb).includes('None') ? 0 : 1;
        return na - nb;
      }

      const bothNum = typeof va === 'number' && typeof vb === 'number';
      if (bothNum) {
        if (isNaN(va) && isNaN(vb)) return 0;
        if (isNaN(va)) return 1;
        if (isNaN(vb)) return -1;
        return cfg.higherBetter ? vb - va : va - vb;
      }
      return String(va).localeCompare(String(vb));
    }

    function visibleDataRows() {
      return rows.filter(r => !r.classList.contains('ampc-row') && r.style.display !== 'none');
    }

    function applyGlobalHeatmap() {
      const dataRows = visibleDataRows();
      headers.forEach((th, cidx) => {
        const cfg = colConfig[cidx];
        if (!cfg || !cfg.numeric) return;
        if (th.textContent.trim() === 'Rank') return;  // rank is not heat-mapped
        const vals = dataRows.map(r => getValue(r, cidx)).filter(v => typeof v === 'number' && !isNaN(v));
        if (vals.length === 0) return;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        dataRows.forEach(r => {
          const td = r.children[cidx];
          const v = getValue(r, cidx);
          if (typeof v === 'number' && !isNaN(v) && max > min) {
            const t = cfg.higherBetter ? (v - min) / (max - min) : (max - v) / (max - min);
            td.style.backgroundColor = getRankColor(t);
          }
        });
      });
    }

    function sortBy(idx, dir) {
      const cfg = colConfig[idx];
      rows.sort((a, b) => {
        // Keep AMPC reference row at the top for every sort
        if (a.classList.contains('ampc-row')) return -1;
        if (b.classList.contains('ampc-row')) return 1;
        const base = cfg ? compare(a, b, idx, cfg) : compare(a, b, idx, { higherBetter: true, numeric: false });
        return dir === 'desc' ? -base : base;
      });
      rows.forEach(r => tbody.appendChild(r));

      // Reset to global heatmap for every numeric column
      rows.forEach(r => {
        Array.from(r.children).forEach(td => { td.style.backgroundColor = ''; });
      });
      applyGlobalHeatmap();

      // Override the sorted column: top visible rows are red, bottom are blue
      if (cfg && cfg.numeric) {
        const dataRows = visibleDataRows();
        const n = dataRows.length;
        dataRows.forEach((r, pos) => {
          const td = r.children[idx];
          const v = getValue(r, idx);
          if (typeof v === 'number' && !isNaN(v) && n > 1) {
            const t = 1 - pos / (n - 1);  // 1 at top (red), 0 at bottom (blue)
            td.style.backgroundColor = getRankColor(t);
          }
        });
      }
      currentSort = { idx: idx, dir: dir };
    }

    function markBetterThanAMPC() {
      if (!ampcRow) return;
      headers.forEach((th, idx) => {
        const cfg = colConfig[idx];
        if (!cfg) return;
        if (th.textContent.trim() === 'Rank') return;  // rank is not compared against AMPC
        const ampcVal = getValue(ampcRow, idx);
        if (typeof ampcVal !== 'number' || isNaN(ampcVal)) return;
        rows.forEach(r => {
          if (r.classList.contains('ampc-row')) return;
          const td = r.children[idx];
          const v = getValue(r, idx);
          if (typeof v === 'number' && !isNaN(v)) {
            const better = cfg.higherBetter ? v > ampcVal : v < ampcVal;
            if (better) td.classList.add('better-than-ampc');
            else td.classList.remove('better-than-ampc');
          }
        });
      });
    }

    function closeMenu() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
    }

    function ampcValue(idx) {
      return ampcRow ? getValue(ampcRow, idx) : NaN;
    }

    function isBetter(v, threshold, cfg) {
      if (typeof v !== 'number' || isNaN(v) || typeof threshold !== 'number' || isNaN(threshold) || !cfg) return false;
      return cfg.higherBetter ? v > threshold : v < threshold;
    }

    function applyFilters() {
      const filterIdx = Object.keys(activeFilters).map(Number);
      let visibleCount = 0;
      rows.forEach(r => {
        if (r.classList.contains('ampc-row')) { r.style.display = ''; return; }
        let show = true;
        for (const idx of filterIdx) {
          const f = activeFilters[idx];
          const v = getValue(r, idx);
          if (f.type === 'categorical') {
            if (!f.values.includes(String(v))) { show = false; break; }
          } else {
            const cfg = colConfig[idx];
            const threshold = f.type === 'ampc' ? ampcValue(idx) : f.threshold;
            if (!isBetter(v, threshold, cfg)) { show = false; break; }
          }
        }
        r.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });

      // Clear backgrounds and re-apply heatmap to visible rows
      rows.forEach(r => {
        Array.from(r.children).forEach(td => { td.style.backgroundColor = ''; });
      });
      applyGlobalHeatmap();

      // Re-apply sorted-column highlight
      if (currentSort.idx !== null && colConfig[currentSort.idx] && colConfig[currentSort.idx].numeric) {
        const dataRows = visibleDataRows();
        const n = dataRows.length;
        dataRows.forEach((r, pos) => {
          const td = r.children[currentSort.idx];
          const v = getValue(r, currentSort.idx);
          if (typeof v === 'number' && !isNaN(v) && n > 1) {
            const t = 1 - pos / (n - 1);
            td.style.backgroundColor = getRankColor(t);
          }
        });
      }

      updateHeaderStates();
      updateFilterStatus(visibleCount);
    }

    function updateHeaderStates() {
      headers.forEach((th, idx) => {
        if (activeFilters[idx]) th.classList.add('has-filter');
        else th.classList.remove('has-filter');
      });
    }

    function updateFilterStatus(visibleCount) {
      if (!filterStatus) return;
      const keys = Object.keys(activeFilters).map(Number);
      if (keys.length === 0) {
        filterStatus.style.display = 'none';
        filterStatus.innerHTML = '';
        return;
      }
      const totalCandidates = rows.length - (ampcRow ? 1 : 0);
      const parts = keys.map(idx => {
        const cfg = colConfig[idx];
        const f = activeFilters[idx];
        const name = headers[idx].textContent.trim();
        if (f.type === 'categorical') {
          return `${name} = ${f.values.join(', ')}`;
        }
        const symbol = cfg && cfg.higherBetter ? '>' : '<';
        const val = f.type === 'ampc' ? 'AMPC' : f.threshold;
        return `${name} ${symbol} ${val}`;
      });
      filterStatus.style.display = '';
      filterStatus.innerHTML = `<span>Showing ${visibleCount} / ${totalCandidates} candidates. Active filters: ${parts.join('; ')}</span><button id="clear-all-filters">Clear all filters</button>`;
      document.getElementById('clear-all-filters').addEventListener('click', clearAllFilters);
    }

    function clearAllFilters() {
      Object.keys(activeFilters).forEach(k => delete activeFilters[k]);
      applyFilters();
    }

    function setFilter(idx, type) {
      activeFilters[idx] = { type: type };
      applyFilters();
    }

    function filterCustom(idx) {
      const cfg = colConfig[idx];
      const name = headers[idx].textContent.trim();
      const direction = cfg && cfg.higherBetter ? 'higher is better' : 'lower is better (e.g. more negative for binding affinities)';
      const example = cfg && cfg.higherBetter ? 'e.g. 6.0' : 'e.g. -8.0';
      const raw = prompt(`Filter ${name}. Enter threshold (${direction}). ${example}:`);
      if (raw === null) return;
      const val = parseFloat(raw);
      if (isNaN(val)) {
        alert('Please enter a valid number.');
        return;
      }
      activeFilters[idx] = { type: 'custom', threshold: val };
      applyFilters();
    }

    function categoricalOptions(idx) {
      const name = headers[idx].textContent.trim();
      const values = new Set();
      rows.forEach(r => {
        if (r.classList.contains('ampc-row')) return;
        const v = getValue(r, idx);
        const s = String(v).trim();
        if (s && s !== '—' && s !== 'N/A (ref)') values.add(s);
      });
      let arr;
      if (name === 'Patent risk') {
        const order = ["Low", "Low-Medium", "Medium", "Marginal", "High"];
        arr = order.filter(x => values.has(x));
      } else {
        arr = Array.from(values).sort((a, b) => a.localeCompare(b));
      }
      return arr;
    }

    function createCategoricalFilterSection(idx, menu) {
      const group = document.createElement('div');
      group.className = 'col-menu-check-group';
      group.addEventListener('click', (e) => e.stopPropagation());

      const label = document.createElement('div');
      label.className = 'col-menu-label';
      label.textContent = 'Filter by value (multi-select):';
      group.appendChild(label);

      const options = categoricalOptions(idx);
      const active = activeFilters[idx];
      const activeValues = active && active.type === 'categorical' ? active.values : [];

      options.forEach(val => {
        const row = document.createElement('div');
        row.className = 'col-menu-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = val;
        cb.checked = activeValues.includes(val);
        cb.id = 'cf-' + idx + '-' + val.replace(/\\W+/g, '_');
        const lbl = document.createElement('label');
        lbl.htmlFor = cb.id;
        lbl.textContent = val;
        row.appendChild(cb);
        row.appendChild(lbl);
        group.appendChild(row);
      });

      const update = () => {
        const checked = Array.from(group.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        if (checked.length === 0) delete activeFilters[idx];
        else activeFilters[idx] = { type: 'categorical', values: checked };
        applyFilters();
      };
      group.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', update));

      menu.appendChild(group);
    }

    function createMenu(th, idx) {
      const cfg = colConfig[idx];
      const categorical = isCategorical(idx);
      const hasFilter = !!activeFilters[idx];
      const m = document.createElement('div');
      m.className = 'col-menu';

      // Sort options
      const items = [
        { label: 'Sort ascending', action: () => sortBy(idx, 'asc') },
        { label: 'Sort descending', action: () => sortBy(idx, 'desc') }
      ];
      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'col-menu-item';
        div.textContent = item.label;
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          item.action();
        });
        m.appendChild(div);
      });

      // Numeric filters
      if (!categorical) {
        const hr = document.createElement('div');
        hr.className = 'col-menu-hr';
        m.appendChild(hr);
        const numericItems = [
          { label: 'Filter: better than AMPC', action: () => setFilter(idx, 'ampc'), disabled: !cfg || idx === 0 },
          { label: 'Filter: better than custom value...', action: () => filterCustom(idx), disabled: !cfg }
        ];
        numericItems.forEach(item => {
          const div = document.createElement('div');
          div.className = 'col-menu-item' + (item.disabled ? ' disabled' : '');
          div.textContent = item.label;
          if (!item.disabled) {
            div.addEventListener('click', (e) => {
              e.stopPropagation();
              closeMenu();
              item.action();
            });
          }
          m.appendChild(div);
        });
      }

      // Categorical multi-select
      if (categorical) {
        createCategoricalFilterSection(idx, m);
      }

      // Clear this filter
      if (hasFilter) {
        const hr = document.createElement('div');
        hr.className = 'col-menu-hr';
        m.appendChild(hr);
        const div = document.createElement('div');
        div.className = 'col-menu-item';
        div.textContent = 'Clear this filter';
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          delete activeFilters[idx];
          applyFilters();
        });
        m.appendChild(div);
      }

      return m;
    }

    function openMenu(th, idx, event) {
      closeMenu();
      menu = createMenu(th, idx);
      document.body.appendChild(menu);
      const rect = th.getBoundingClientRect();
      menu.style.display = 'block';
      menu.style.top = (rect.bottom + window.scrollY) + 'px';
      menu.style.left = (rect.left + window.scrollX) + 'px';
      event.stopPropagation();
    }

    document.addEventListener('click', closeMenu);

    headers.forEach((th, idx) => {
      th.style.cursor = 'pointer';
      th.title = 'Click for sort / filter options';
      th.addEventListener('click', (e) => openMenu(th, idx, e));
    });

    markBetterThanAMPC();
    applyFilters();
    sortBy(0, 'asc');  // Default sort by Rank: AMPC first, then candidates 1..500
  })();
  </script>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AMPC Project Report: From Hypothesis to Candidate Molecules</title>
  <link rel="stylesheet" href="static/style.css">
</head>
<body>
  <header>
    <h1>AMPC Project Report</h1>
    <p class="subtitle">From scientific hypothesis, generative-AI implementation, to candidate selection · {summary['date']}</p>
  </header>

  <main>
    <!-- 1. Scientific hypothesis -->
    <section id="hypothesis">
      <h2>1. Scientific Hypothesis and Objectives</h2>
      <ul>
        <li><strong>Target</strong>: Trefoil factor 3 (TFF3) is over-expressed in multiple cancers. Cys57 forms an intramolecular disulfide bond that is critical for protein stability.</li>
        <li><strong>Mechanism</strong>: AMPC-like reversible covalent inhibitors form a sulfur–carbon bond between the enaminonitrile warhead and Cys57 thiol, thereby inhibiting TFF3.</li>
        <li><strong>Core hypothesis</strong>: By preserving AMPC's covalent warhead and key binding features, generative AI can explore structural analogs that simultaneously optimize potency, ADMET properties, and patent space, yielding novel lead-like molecules.</li>
      </ul>
      <img class="wide" src="images/ampc_reference_highlighted.svg" alt="AMPC reference with highlighted warhead">
      <p class="caption">2D structure of reference molecule AMPC. The enaminonitrile warhead (N#CC(=C(N)O)) is highlighted in red.</p>
    </section>

    <!-- 2. Pipeline overview -->
    <section id="pipeline">
      <h2>2. Pipeline Overview</h2>
      <p>
        The project follows a six-stage workflow: generation → filtering → docking → property prediction → patent screening → integrated ranking.
        The diagram below shows the complete data flow from the scientific hypothesis to the final prioritized candidates.
      </p>
      {pipeline_html}
      <p>
        Key design choices: <strong>multi-model parallel generation</strong> (RL varA/B/C/D + Mol2Mol) to cover diverse chemical space;
        <strong>hard filters first</strong> (warhead, property, structural alerts) to ensure downstream molecules are drug-like;
        <strong>source quotas</strong> to prevent any single model from dominating the final candidate pool.
      </p>
    </section>

    <!-- 3. Molecular generation strategies -->
    <section id="generation">
      <h2>3. Molecular Generation Strategies</h2>
      <p>
        All molecules were generated with <strong>REINVENT4</strong>, an open-source generative-chemistry
        framework developed by MolecularAI. REINVENT4 trains a SMILES-based recurrent neural network prior and
        exposes three core generative modes: <em>transfer learning</em> to bias the prior toward a reference
        scaffold, <em>reinforcement learning (RL)</em> to optimize custom reward functions, and
        <em>Mol2Mol</em>, an encoder-decoder model that samples analogs around a reference molecule under
        similarity or scaffold constraints. We used the RL and Mol2Mol branches in parallel to cover both
        scaffold hopping and side-chain exploration while preserving the enaminonitrile warhead.
      </p>
      <p>
        The original REINVENT4 prior rarely produced enaminonitrile warheads. We therefore performed transfer
        learning on the AMPC structure (200 epochs, no randomization) to obtain
        <code>TL_reinvent_ampc_norand.model</code>, which stably generates the required warhead. Four parallel
        RL reward variants and a Mol2Mol pilot-to-production workflow were then executed.
      </p>
      <img class="wide" src="images/model_variants.png" alt="Molecular generation strategies pipeline">

      <h3>Common RL settings</h3>
      <p>
        All four RL variants shared the same staged-learning framework and hyper-parameters; only the reward
        function, aggregation, and prior differed.
      </p>
      <table>
        <thead>
          <tr><th>Parameter</th><th>Value</th></tr>
        </thead>
        <tbody>
          <tr><td>Framework</td><td>REINVENT4 staged_learning</td></tr>
          <tr><td>Batch size</td><td>256</td></tr>
          <tr><td>Randomize SMILES</td><td>true</td></tr>
          <tr><td>Learning strategy</td><td>DAP: sigma = 128, rate = 1e-4</td></tr>
          <tr><td>Diversity filter</td><td>IdenticalMurckoScaffold (bucket = 100, minscore = 0.4, minsimilarity = 0.4, penalty = 0.5)</td></tr>
          <tr><td>Termination per stage</td><td>simple (max_score), min_steps = 50, max_steps = 5000</td></tr>
          <tr><td>Inception seed</td><td>AMPC SMILES (memory_size varies: varA 200, varB/varD 100, varC 30)</td></tr>
        </tbody>
      </table>

      <h3>RL variant details</h3>
      <table>
        <thead>
          <tr><th>Variant</th><th>Strategy</th><th>Key parameters</th><th>Generated molecules</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>varA</td>
            <td>AMPC-likeness reward (conservative)</td>
            <td>
              Prior: TL AMPC prior<br>
              Aggregation: geometric_mean<br>
              Stage 1: Tanimoto 0.40, warhead 0.30, max_score 0.45<br>
              Stage 2: Tanimoto 0.30, warhead 0.20, max_score 0.55
            </td>
            <td>1,280,000</td>
          </tr>
          <tr>
            <td>varB</td>
            <td>Similarity/scaffold balance</td>
            <td>
              Prior: TL AMPC prior<br>
              Aggregation: arithmetic_mean<br>
              Stage 1: Tanimoto 0.35, warhead 0.30, max_score 0.45<br>
              Stage 2: Tanimoto 0.25, warhead 0.20, max_score 0.55
            </td>
            <td>723,712</td>
          </tr>
          <tr>
            <td>varC</td>
            <td>Scaffold hopping (aggressive)</td>
            <td>
              Prior: reinvent.prior<br>
              Aggregation: arithmetic_mean<br>
              Stage 1: Tanimoto 0.15, warhead 0.30, max_score 0.45<br>
              Stage 2: Tanimoto 0.05, warhead 0.20, max_score 0.55<br>
              Extra: false-positive blacklist
            </td>
            <td>244,480</td>
          </tr>
          <tr>
            <td>varD</td>
            <td>AMPC prior + full reward</td>
            <td>
              Prior: TL AMPC prior<br>
              Aggregation: arithmetic_mean<br>
              Stage 1: Tanimoto 0.25, warhead 0.10 (soft), max_score 0.50<br>
              Stage 2: Tanimoto 0.25, warhead 0.10 (soft), max_score 0.65<br>
              Extra: QED, MW, SlogP, SA, TPSA, rotatable bonds
            </td>
            <td>1,390,592</td>
          </tr>
        </tbody>
      </table>

      <h3>Mol2Mol pilot and production</h3>
      <table>
        <thead>
          <tr><th>Prior</th><th>Samples</th><th>Valid molecules</th><th>Valid rate</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td>mol2mol_similarity.prior</td><td>10,000</td><td>530</td><td>5.30%</td><td>Selected for production</td></tr>
          <tr><td>mol2mol_high_similarity.prior</td><td>10,000</td><td>209</td><td>2.09%</td><td></td></tr>
          <tr><td>mol2mol_mmp.prior</td><td>10,000</td><td>174</td><td>1.74%</td><td></td></tr>
          <tr><td>mol2mol_scaffold.prior</td><td>10,000</td><td>125</td><td>1.25%</td><td></td></tr>
          <tr><td>mol2mol_scaffold_generic.prior</td><td>10,000</td><td>167</td><td>1.67%</td><td></td></tr>
          <tr><td>mol2mol_similarity.prior (production)</td><td>500,000</td><td>3,397 valid unique</td><td>0.68%</td><td>Final Mol2Mol source</td></tr>
        </tbody>
      </table>
      <p>
        <small><strong>Note:</strong> The table compares five distinct Mol2Mol priors. A separate 10,000-molecule control run using the same <code>mol2mol_similarity.prior</code> with <code>isomeric_smiles=true</code> was also performed; it is not a new prior and is therefore omitted from the prior comparison, but it is counted as a 10k run in the resource accounting.</small>
      </p>
    </section>

    <!-- 4. Filtering funnel -->
    <section id="funnel">
      <h2>4. Filtering Funnel</h2>
      <p>
        Molecules from six sources passed unified warhead/property/structural-alert hard filters, followed by deduplication,
        Murcko scaffold clustering, and source quotas, to produce the Top 500. The funnel shows how a ~1.4 M pool
        is compressed to 500 high-quality candidates.
      </p>

      <h3>Hard-filter parameters</h3>
      <table>
        <thead>
          <tr><th>Filter category</th><th>Parameter</th><th>Value / SMARTS</th></tr>
        </thead>
        <tbody>
          <tr><td rowspan="2">Warhead</td><td>Enaminonitrile SMARTS</td><td><code>N#CC(=C([NH2,NH1;!R;!$(N-[C,S](=O))])O)</code></td></tr>
          <tr><td>False-positive blacklist</td><td>Oxazolin-5-one, N-acylated / thioacylated / sulfonylated enaminonitrile, etc.</td></tr>
          <tr><td rowspan="7">Property filters</td><td>Molecular weight</td><td>250–550 Da</td></tr>
          <tr><td>LogP</td><td>1.5–5.5</td></tr>
          <tr><td>TPSA</td><td>40–140 Å²</td></tr>
          <tr><td>H-bond donors</td><td>≤ 5</td></tr>
          <tr><td>H-bond acceptors</td><td>≤ 10</td></tr>
          <tr><td>Rotatable bonds</td><td>≤ 10</td></tr>
          <tr><td>SA score</td><td>≤ 4.5</td></tr>
          <tr><td>Source score threshold</td><td>Stage-1 Tier-2 sources</td><td>Score > 0.6 for varA_s1, varB_s1, varC_s1</td></tr>
        </tbody>
      </table>

      <h3>Clustering, scoring and quotas</h3>
      <p>
        After filtering, molecules are ranked by a composite score that balances drug-likeness, warhead preservation,
        AMPC similarity, structural novelty, and synthetic accessibility. The score is used both to pick cluster
        representatives and to enforce source quotas.
      </p>
      <div class="formula">
        composite_score = 0.25·QED + 0.20·warhead + 0.20·AMPC_likeness + 0.10·novelty + 0.15·synth + 0.10·source_score
      </div>
      <p class="caption">
        AMPC_likeness = 0.6·Tanimoto(AMPC) + 0.4·MW_similarity(AMPC); &nbsp;
        synth = 1/SA_score; &nbsp;
        novelty = 1 − Tanimoto(AMPC); &nbsp;
        source_score is min–max normalized per source.
      </p>
      <table>
        <thead>
          <tr><th>Step</th><th>Parameter</th><th>Value</th></tr>
        </thead>
        <tbody>
          <tr><td>Deduplication</td><td>Canonical SMILES</td><td>RDKit canonical, non-isomeric</td></tr>
          <tr><td>Clustering</td><td>Murcko scaffold</td><td>Identical Murcko scaffold = one cluster</td></tr>
          <tr><td>Representatives</td><td>Reps per scaffold</td><td>Top 3 by composite_score</td></tr>
          <tr><td rowspan="6">Composite score weights</td><td>QED</td><td>0.25</td></tr>
          <tr><td>Warhead match</td><td>0.20</td></tr>
          <tr><td>AMPC-likeness (Tanimoto + MW similarity)</td><td>0.20</td></tr>
          <tr><td>Novelty (1 − Tanimoto to AMPC)</td><td>0.10</td></tr>
          <tr><td>Synthetic accessibility (1/SA)</td><td>0.15</td></tr>
          <tr><td>Normalized source score</td><td>0.10</td></tr>
          <tr><td rowspan="2">Source quotas (Top 500)</td><td>Minimum per source</td><td>20</td></tr>
          <tr><td>Maximum per source</td><td>300</td></tr>
          <tr><td rowspan="2">Source quotas (Top 100)</td><td>Minimum per source</td><td>5</td></tr>
          <tr><td>Maximum per source</td><td>50</td></tr>
        </tbody>
      </table>

      <img class="wide" src="images/filter_funnel.png" alt="Filter funnel">
      <p class="caption">Candidate pool reduction through the filtering funnel.</p>

      <h3>Source-balance effect</h3>
      <p>
        Without quotas, the Top 500 was almost entirely dominated by the highest-scoring source
        (<code>varD_full</code>). The source-quota step enforces a minimum and maximum number of
        molecules per generation source, guaranteeing that the final pool retains diverse chemistry
        from every contributing model.
      </p>
      <img class="wide" src="images/source_balance.png" alt="Source balance before and after quotas">

      <p>
        <strong>Key lesson: The first unified analysis lacked source quotas and was dominated by varC_s2 (497/500),
        with many fragments/false positives. v2 introduced min/max-per-source quotas, yielding a more balanced and diverse pool.</strong>
      </p>

      <h3>Input sources</h3>
      <p>The table tracks how molecules from each generation source are reduced through the filtering funnel, from the unfiltered generation output to the final Top 500.</p>
      <table>
        <thead>
          <tr><th>Source</th><th>Description</th><th>Source input</th><th>After hard filter</th><th>After deduplication</th><th>After cluster</th><th>Final Top-500 count</th></tr>
        </thead>
        <tbody>
          {source_rows}
        </tbody>
      </table>

      <img class="wide" src="images/property_distributions.png" alt="Property distributions">
      <p class="caption">Property distributions of the Top-500 candidates after hard filtering.</p>

      <img class="wide" src="images/properties_by_source.png" alt="Properties by source">
      <p class="caption">Drug-like properties by generation source. Red dashed lines mark the AMPC reference values.</p>
    </section>

    <!-- 5. Structural alerts -->
    <section id="structural-alerts">
      <h2>5. Structural Alerts (PAINS / BRENK)</h2>
      <p>
        All 500 candidates were screened with two complementary structural-alert catalogs:
        <strong>PAINS</strong> (Pan-Assay Interference Compounds) and <strong>BRENK</strong> (Brenk structural alert filter).
        PAINS catches promiscuous assay interferers such as Michael acceptors, catechols, and rhodanines;
        BRENK flags synthetically or pharmacologically problematic motifs such as anilines, hydrazines, and strained rings.
        A molecule failing either catalog is labeled with <em>any alert</em> in the final table.
      </p>
      <ul>
        <li><strong>Molecules with no alerts:</strong> 468 / 500 (93.6%)</li>
        <li><strong>PAINS alerts:</strong> 13 molecules (2.6%)</li>
        <li><strong>BRENK alerts:</strong> 19 molecules (3.8%)</li>
        <li><strong>Both PAINS and BRENK:</strong> 0 molecules</li>
      </ul>
      <img class="wide" src="images/structural_alerts.png" alt="Structural alerts">
      <p class="caption">
        Left: counts of structural-alert categories across the Top-500 candidates; the red dashed line marks the AMPC reference (BRENK-only alerts: 2-halo_pyridine, cumarine).
        Right: alert-category proportions by generation source, with any alert split into PAINS-only and BRENK-only.
      </p>
      <p>
        <strong>Key finding:</strong> Most alerts are BRENK alerts concentrated in <code>mol2mol_sim500k</code> and <code>varA_s1_gt0.6</code>,
        whereas <code>varD_full</code> contributes the largest absolute number of PAINS alerts (10 molecules, 3.3% of its subset).
        <code>varB_s1_gt0.6</code> and <code>varB_s2</code> are completely alert-free.
        Notably, the AMPC reference itself carries two BRENK alerts, so candidates with no alerts are already cleaner than the reference in this dimension.
        All alerted molecules are retained in the table for transparency but are down-weighted in the integrated score.
      </p>
    </section>

    <!-- 6. AutoDock Vina non-covalent docking -->
    <section id="vina">
      <h2>6. AutoDock Vina Non-Covalent Docking</h2>
      <p>
        AutoDock Vina was run first to score how well each candidate fits the TFF3 binding pocket using a standard empirical scoring function.
      </p>

      <img class="wide" src="images/vina_workflow.png" alt="AutoDock Vina workflow">
      <p class="caption">AutoDock Vina non-covalent docking workflow: receptor preparation, ligand embedding, docking, and top-affinity extraction.</p>

      <p>
        The docking search box was centered on the Cys57 thiol side chain (SG atom) of TFF3 (PDB 1PE3), because the enaminonitrile warhead is expected to form a reversible C–S bond with Cys57. A 25 Å box was used to cover the pocket around this covalent anchor and to allow flexible placement of the remaining scaffold.
      </p>

      <table>
        <thead>
          <tr><th>Parameter</th><th>Value</th></tr>
        </thead>
        <tbody>
          <tr><td>Software</td><td>AutoDock Vina 1.2.5 (Python API 1.2.7)</td></tr>
          <tr><td>Scoring function</td><td>Vina</td></tr>
          <tr><td>Receptor</td><td>TFF3 1PE3 (prepared PDBQT)</td></tr>
          <tr><td>Covalent anchor</td><td>Cys57 SG atom</td></tr>
          <tr><td>Box center (Å)</td><td>(−0.634, −0.211, 0.198)</td></tr>
          <tr><td>Box size (Å)</td><td>25 × 25 × 25</td></tr>
          <tr><td>Exhaustiveness</td><td>32</td></tr>
          <tr><td>Poses per ligand</td><td>9</td></tr>
          <tr><td>CPU per worker</td><td>1</td></tr>
          <tr><td>Retained score</td><td>Top pose affinity (kcal/mol)</td></tr>
        </tbody>
      </table>

      <div style="display:flex; gap:1.5rem; align-items:flex-start; margin:1.5rem 0;">
        <img src="images/vina_affinity_distribution.png" alt="Vina affinity distribution" style="flex:1; max-width:50%; margin:0;">
        <img src="images/vina_warhead_distance.png" alt="Vina warhead distance" style="flex:1; max-width:50%; margin:0;">
      </div>
      <p class="caption">
        Left: distribution of AutoDock Vina top affinity across the 501 molecules (more negative = stronger predicted non-covalent binding).
        Right: warhead–Cys57 SG distances from the Vina poses; distances are longer than covalent bond lengths because Vina was run without a covalent constraint.
      </p>

      <p>
        <strong>Limitation:</strong> AutoDock Vina cannot model covalent bonds. Because the enaminonitrile warhead is expected to form a reversible C–S bond with Cys57, the Vina poses do not reproduce the covalent geometry (e.g., AMPC redock shows a 9.89 Å warhead–Cys57 distance). Vina affinity is therefore used only as a supplemental ranking component, not as the primary potency metric.
      </p>
    </section>

    <!-- 7. GNINA covalent docking -->
    <section id="gnina">
      <h2>7. GNINA Covalent Docking</h2>
      <p>
        To capture the reversible covalent mechanism, GNINA was run with a covalent restraint between the ligand warhead β-carbon and Cys57 SG. CNN scoring (rescore) was used to refine the poses, and a geometric warhead distance filter (< 2.5 Å to Cys57 SG) was applied.
        All 501 molecules passed the geometric filter. The AMPC reference showed warhead–Cys57 SG distances of 1.57 Å / 1.79 Å, consistent with typical C–S covalent bond lengths.
      </p>
      <img class="wide" src="images/gnina_workflow.png" alt="GNINA covalent docking workflow">
      <p class="caption">GNINA covalent docking workflow using the β-carbon as the attachment atom and a geometric filter on the warhead–Cys57 SG distance.</p>
      <img class="wide" src="images/gnina_distribution.png" alt="GNINA CNN affinity distribution">
      <p class="caption">GNINA CNN affinity distribution for the 501 molecules. Higher CNN affinity indicates stronger predicted covalent binding.</p>
    </section>

    <!-- 8. ADMET and Structural Safety -->
    <section id="admet">
      <h2>8. ADMET and Structural Safety</h2>
      <p>
        ADMETlab 3.0 provides 119 endpoints, which were grouped into three hard-filter tiers:
        <strong>absorption</strong> (permeability, solubility), <strong>distribution/metabolism</strong> (plasma protein binding, CYP inhibition, hERG, etc.),
        and <strong>toxicity/physicochemical</strong> (QED, AMES, teratogenicity, etc.).
      </p>

      <h3>Tier definitions</h3>
      <p>
        Molecules are classified by the most stringent safety tier they satisfy. Tier A requires passing hard structural/quality filters plus strict toxicity thresholds; Tier B relaxes several thresholds relative to the AMPC reference; Tier C only requires the hard filters.
      </p>

      <table>
        <thead>
          <tr><th>Hard structural / quality filter (Tier C basis)</th><th>Threshold</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <tr><td>QED</td><td>&ge; 0.5</td><td>Basic drug-likeness</td></tr>
          <tr><td>Lipinski Rule</td><td>Accepted</td><td>Oral Rule-of-5 compliance</td></tr>
          <tr><td>Molecular weight</td><td>&le; 500 Da</td><td>Oral drug space</td></tr>
          <tr><td>LogP</td><td>&le; 5</td><td>Avoid excessive lipophilicity</td></tr>
          <tr><td>PAINS</td><td>= 0</td><td>No pan-assay interference</td></tr>
          <tr><td>Reactive compounds</td><td>&lt; 0.1</td><td>Low chemical reactivity</td></tr>
          <tr><td>Promiscuous compounds</td><td>&lt; 0.3</td><td>Lower off-target risk</td></tr>
          <tr><td>FLuc inhibitors</td><td>&lt; 0.2</td><td>Avoid luciferase false positives</td></tr>
        </tbody>
      </table>

      <table>
        <thead>
          <tr><th>Tier A (strict safety) — additional thresholds on top of hard filters</th><th>Threshold</th></tr>
        </thead>
        <tbody>
          <tr><td>AMES Toxicity</td><td>&lt; 0.5</td></tr>
          <tr><td>hERG Blockers</td><td>&lt; 0.3</td></tr>
          <tr><td>Skin Sensitization</td><td>&lt; 0.5</td></tr>
          <tr><td>A549 Cytotoxicity</td><td>&lt; 0.2</td></tr>
          <tr><td>HEK293 Cytotoxicity</td><td>&lt; 0.5</td></tr>
          <tr><td>Colloidal aggregators</td><td>&lt; 0.5</td></tr>
          <tr><td>Hematotoxicity</td><td>&lt; 0.5</td></tr>
          <tr><td>Eye Corrosion</td><td>&lt; 0.1</td></tr>
          <tr><td>Eye Irritation</td><td>&lt; 0.5</td></tr>
        </tbody>
      </table>

      <table>
        <thead>
          <tr><th>Tier B (moderate safety, AMPC-referenced) — additional thresholds on top of hard filters</th><th>Threshold</th></tr>
        </thead>
        <tbody>
          <tr><td>AMES Toxicity</td><td>&le; AMPC (0.637)</td></tr>
          <tr><td>hERG Blockers</td><td>&lt; 0.5</td></tr>
          <tr><td>Skin Sensitization</td><td>&lt; 0.5</td></tr>
          <tr><td>A549 Cytotoxicity</td><td>&lt; 0.3</td></tr>
          <tr><td>HEK293 Cytotoxicity</td><td>&lt; 0.6</td></tr>
          <tr><td>Colloidal aggregators</td><td>&lt; 0.7</td></tr>
        </tbody>
      </table>

      <div style="display:flex; gap:1.5rem; align-items:flex-start; margin:1.5rem 0;">
        <img src="images/admet_tier_distribution.png" alt="ADMET tier distribution" style="flex:1; max-width:50%; margin:0;">
        <img src="images/admet_tier_by_source.png" alt="ADMET tier distribution by source" style="flex:1; max-width:50%; margin:0;">
      </div>
      <p class="caption">
        Left: overall ADMET tier distribution for the 501 molecules (500 candidates + AMPC reference); the red dashed line marks AMPC, which falls in Failed (0/3).
        Right: ADMET tier distribution broken down by generation source, including the AMPC reference.
      </p>

      <ul>
        <li>Tier A (3/3 passed): 28; Tier B (2/3 passed): 89; Tier C (1/3 passed): 267; failed hard filters: 117 (including AMPC).</li>
        <li>PAINS/BRENK alerts: 32 / 500 (6.4%), all outside Tier A/B, showing strong agreement between ADMET and structural safety filters.</li>
        <li>266 / 500 non-AMPC candidates were overall better than AMPC across 13 key toxicity endpoints.</li>
      </ul>
    </section>

    <!-- 9. BoltzMol-1 structural confidence -->
    <section id="boltz">
      <h2>9. BoltzMol-1 Structural Confidence</h2>
      <p>
        BoltzMol-1 was used to predict structural confidence for AMPC + Top 500. The initial run returned 468/501 structures; 33 molecules (including AMPC) were filtered by Boltz's internal SMARTS catalog. These 33 molecules were retried with <code>boltz_smarts_catalog_filter_level=disabled</code> and merged to reach full 501/501 coverage.
      </p>

      <img class="wide" src="images/boltz_workflow.png" alt="BoltzMol-1 workflow">
      <p class="caption">BoltzMol-1 structural confidence workflow. The initial run filtered 33 molecules by the internal SMARTS catalog; they were retried with the filter disabled and merged back.</p>

      <img class="wide" src="images/boltz_distribution.png" alt="BoltzMol-1 confidence distribution">
      <p class="caption">BoltzMol-1 confidence distributions for the 501 molecules. Coral bars show the 33 retried molecules; red dashed lines mark the AMPC reference values. Retried molecules are labeled with an asterisk (*) in the final candidate table.</p>
    </section>

    <!-- 10. Patent risk -->
    <section id="patent">
      <h2>10. Patent Risk Screening (WO2018226155A1)</h2>
      <p>
        Using the patent claim 1 core (pyranochromene lactone + para-phenyl + enaminonitrile warhead A) as reference,
        the Top 500 were evaluated by SMARTS substructure matching and Tanimoto similarity. High-risk molecules fall
        directly into claim 1; Low / Low-Medium risk molecules are preferred for downstream synthesis.
      </p>
      <div style="display:flex; gap:1.5rem; align-items:flex-start; margin:1.5rem 0;">
        <img src="images/patent_risk_counts.png" alt="Patent risk level counts" style="flex:1; max-width:50%; margin:0;">
        <img src="images/patent_risk_by_source.png" alt="Patent risk distribution by source" style="flex:1; max-width:50%; margin:0;">
      </div>
      <p class="caption">
        Left: counts of molecules in each patent risk level (n = 500).
        Right: patent risk distribution broken down by the six generation sources (n = 500); numbers at the end of each bar show source counts and percentages.
      </p>
      <p>
        <strong>Key finding</strong>: No High-risk molecules appear in the Top 20 integrated ranking, and none in the Top 50.
        The 9 High-risk molecules are mainly in varD_full and Mol2Mol_sim500k, retaining the core scaffold closest to AMPC.
      </p>
    </section>

    <!-- 11. Integrated ranking and candidate table -->
    <section id="ranking">
      <h2>11. Integrated Ranking and All Candidate Molecules (n = {summary['n_total'] + 1})</h2>
      <p>
        The table below lists all 500 generated candidates plus the AMPC reference molecule. For each molecule it shows
        the 2D structure, generation source, key docking scores (GNINA CNN affinity and Vina affinity), ADMET tier,
        BoltzMol-1 structural confidence, patent risk level, structural alerts, and final integrated score.
      </p>
      <pre class="formula">integrated_score =
  0.25 * admet_tier_norm
  + 0.25 * gnina_cnn_affinity_norm
  + 0.15 * vina_affinity_norm
  + 0.15 * composite_score_norm
  + 0.10 * boltz_binding_confidence_norm
  + 0.05 * warhead_geometry_norm
  + 0.05 * structural_alerts_norm</pre>
      <p>
        This weighting balances drug-likeness (ADMET), predicted binding strength (GNINA / Vina), generative model score
        (composite_score), structural confidence (Boltz), covalent geometry, and structural alerts.
      </p>

      <p>
        <strong>*</strong> Molecules that were initially filtered by BoltzMol-1's internal SMARTS catalog and later retried with <code>boltz_smarts_catalog_filter_level=disabled</code> are marked with an asterisk in the Rank column.
      </p>

      <p style="margin-bottom:1rem;">
        <a href="table.html" target="_blank" style="display:inline-block; padding:0.6rem 1.2rem; background:#007bff; color:#fff; text-decoration:none; border-radius:4px; font-weight:bold;">在新窗口中显示此表格</a>
      </p>

      <div id="filter-status" class="filter-status" style="display:none;"></div>

      <div class="table-wrap">
        <table class="candidate-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Structure</th>
              <th>MW (Da)</th>
              <th>Source</th>
              <th>GNINA CNN</th>
              <th>Vina (kcal/mol)</th>
              <th>ADMET tier</th>
              <th>Boltz confidence</th>
              <th>Patent risk</th>
              <th>Structural alerts</th>
              <th title="Synthetic accessibility score (lower = easier to synthesize)">SA score</th>
              <th>Composite score</th>
              <th>Integrated score</th>
            </tr>
          </thead>
          <tbody>
            {full_rows}
          </tbody>
        </table>
      </div>

      <h3>Download intermediate results</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Result</th><th>Download link</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>RL generation results</td>
              <td>
                <a href="../REINVENT4/output/rl_ampc_a100_varA_1.csv" download>varA stage 1</a> ·
                <a href="../REINVENT4/output/rl_ampc_a100_varB_1.csv" download>varB stage 1</a> ·
                <a href="../REINVENT4/output/rl_ampc_a100_varB_2.csv" download>varB stage 2</a> ·
                <a href="../REINVENT4/output/rl_ampc_a100_varC_2.csv" download>varC stage 2</a> ·
                <a href="../REINVENT4/output/rl_ampc_a100_varD_full_1.csv" download>varD full 1</a> ·
                <a href="../REINVENT4/output/rl_ampc_a100_varD_full_2.csv" download>varD full 2</a>
              </td>
            </tr>
            <tr>
              <td>Mol2Mol generation results</td>
              <td><a href="../REINVENT4/output/mol2mol_samples_similarity_500k.csv" download>mol2mol_similarity_500k.csv</a></td>
            </tr>
            <tr>
              <td>Unified analysis results</td>
              <td>
                <a href="../REINVENT4/output/unified_analysis/candidates_top500.csv" download>candidates_top500.csv</a> ·
                <a href="../REINVENT4/output/unified_analysis/candidates_top100.csv" download>candidates_top100.csv</a> ·
                <a href="../REINVENT4/output/unified_analysis/candidates_clustered.csv" download>candidates_clustered.csv</a>
              </td>
            </tr>
            <tr>
              <td>AutoDock Vina docking results</td>
              <td><a href="../autodock_vina/batch_docking/output/docking_summary.csv" download>docking_summary.csv</a></td>
            </tr>
            <tr>
              <td>GNINA covalent docking results</td>
              <td><a href="../gnina/output/gnina_docking_summary.csv" download>gnina_docking_summary.csv</a></td>
            </tr>
            <tr>
              <td>ADMETlab 3.0 predictions</td>
              <td><a href="../admetlab3/output/analysis/admet_all_flags.csv" download>admet_all_flags.csv</a></td>
            </tr>
            <tr>
              <td>BoltzMol-1 structural confidence</td>
              <td><a href="../boltz/output/boltzmol_all_results.csv" download>boltzmol_all_results.csv</a></td>
            </tr>
            <tr>
              <td>Final integrated ranking</td>
              <td><a href="../integrated_analysis/output/overall_ranking.csv" download>overall_ranking.csv</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 12. Chemical space -->
    <section id="chemical-space">
      <h2>12. Chemical Space and Source Distribution</h2>
      <p>
        Morgan fingerprints (ECFP4) were used for t-SNE dimensionality reduction of all 501 molecules.
        The same embedding is colored below by generation source, key scoring metrics, structural safety,
        docking scores, ADMET tier, BoltzMol-1 confidence, and patent risk, revealing how different
        selection pressures distribute molecules in chemical space.
      </p>
      <img class="wide" src="images/tsne_projection.png" alt="t-SNE overview">
      <p class="caption">
        t-SNE embedding colored by generation source, composite score, integrated score, structural alerts,
        Vina affinity, GNINA CNN affinity, ADMET tier, BoltzMol-1 confidence, and patent risk.
      </p>

      <img class="wide" src="images/tsne_properties.png" alt="t-SNE colored by molecular properties">
      <p class="caption">t-SNE embedding colored by molecular weight, LogP, TPSA, QED, SA score, and Tanimoto similarity to AMPC.</p>

      <img class="wide" src="images/correlation_heatmap.png" alt="Correlation heatmap">
      <p class="caption">Spearman correlations across scoring metrics, ADMET properties and structural features. Vina affinity has been negated so that larger values always indicate better predicted binding.</p>
    </section>
    <!-- 13. Conclusions and next steps -->
    <section id="next">
      <h2>13. Conclusions and Next Steps</h2>
      <p>
        This project delivered an end-to-end, reproducible workflow that transforms the AMPC reference inhibitor into a ranked set of 500 novel candidates. By combining reinforcement-learning and transfer-learning generative models with structure-based docking (GNINA/Vina), ADMET profiling, structural-safety filtering, patent-risk screening, and deep-learning structure confidence (BoltzMol-1), the pipeline moves beyond single-score optimization to a true multi-objective view of early drug discovery.
      </p>
      <ul>
        <li><strong>Candidate quality</strong>: The top tier of the integrated ranking is dominated by RL-derived molecules (especially <em>varD_full</em> and <em>varC_s2</em>) with strong GNINA CNN affinities, favorable ADMET profiles, and acceptable synthetic accessibility. The t-SNE landscape shows that generation sources occupy overlapping but distinct chemical subspaces, justifying the ensemble approach.</li>
        <li><strong>Actionable selection</strong>: We recommend prioritizing 10–20 molecules from the intersection of (i) top-50 integrated score, (ii) ADMET Tier A or B, and (iii) Low or Low-Medium patent risk. These molecules are the most suitable starting points for follow-up medicinal-chemistry triage.</li>
        <li><strong>Risk management</strong>: Nine candidates carry High patent risk and should be excluded from further investment unless freedom-to-operate can be established. An additional Marginal-risk set should be reviewed claim-by-claim before any experimental commitment.</li>
        <li><strong>Limitations</strong>: All docking and ADMET predictions are computational models; they estimate, not guarantee, in vitro behavior. BoltzMol-1 confidence correlates weakly with docking scores and is therefore used as a cross-check rather than a primary filter.</li>
        <li><strong>Next steps</strong>:
          <ol>
            <li>Expert 3-D pose inspection of the top 10–20 candidates in PyMOL/ChimeraX, with particular attention to the covalent warhead geometry.</li>
            <li>Synthetic-feasibility assessment and route scouting: <strong>prioritize molecules with low SA score (&lt; 3.0–3.5)</strong> and flag molecules with SA score &gt; 3.5 (the upper ~2% of the current set) or missing commercial building blocks for additional route review or deprioritization.</li>
            <li>Optional 50–100 ns molecular dynamics on selected complexes to probe pose stability and induced-fit effects.</li>
          </ol>
        </li>
      </ul>
    </section>

    <!-- 14. Resource consumption -->
    <section id="resources">
      <h2>14. Resource Consumption</h2>
      <p>
        The numbers below are taken from the project's SLURM accounting (2026-06-15 to 2026-06-23, user <code>bwsun</code>) and from local workstation records where applicable. GPU time is reported as A100 <strong>card-hours</strong> and CPU time as <strong>core-hours</strong>, because every GPU job also consumes CPU cores.
      </p>
      <div class="table-wrap">
        <table class="resource-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th style="text-align:right">GPU card-hours (A100)</th>
              <th style="text-align:right">CPU core-hours</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Reinforcement-learning generation (varA/B/C/D)</td>
              <td style="text-align:right">10.62</td>
              <td style="text-align:right">84.98</td>
              <td>Staged RL runs; includes multiple variants and retries.</td>
            </tr>
            <tr>
              <td>Transfer learning (AMPC prior training)</td>
              <td style="text-align:right">0.03</td>
              <td style="text-align:right">0.22</td>
              <td>Fine-tuned the base prior on AMPC before RL generation.</td>
            </tr>
            <tr>
              <td>Mol2Mol / similarity-guided generation</td>
              <td style="text-align:right">2.70</td>
              <td style="text-align:right">21.57</td>
              <td>Includes 500k similarity, 200k, 50k, and six 10k runs: similarity, high_similarity, MMP, scaffold, scaffold_generic and isomeric similarity.</td>
            </tr>
            <tr>
              <td>Unify, hard-filter, cluster and rank</td>
              <td style="text-align:right">0.00</td>
              <td style="text-align:right">19.89</td>
              <td>CPU-only post-processing; processed ~1.4M raw molecules down to 500 candidates.</td>
            </tr>
            <tr>
              <td>GNINA covalent docking + pose analysis</td>
              <td style="text-align:right">15.18</td>
              <td style="text-align:right">121.43</td>
              <td>Includes the initial α-carbon SMARTS run, the corrected β-carbon run, and analysis jobs. The final productive docking run itself was ~6.6 GPU card-hours.</td>
            </tr>
            <tr>
              <td>AutoDock Vina docking</td>
              <td style="text-align:right">0.00</td>
              <td style="text-align:right">0.00</td>
              <td>Run locally on a workstation; no server CPU/GPU resources consumed.</td>
            </tr>
            <tr>
              <td>ADMETLab3 web profiling</td>
              <td style="text-align:right">0.00</td>
              <td style="text-align:right">0.00</td>
              <td>Submitted from the local workstation via the ADMETLab3 web API; no server CPU/GPU resources consumed. 501 molecules × ~119 endpoints.</td>
            </tr>
            <tr>
              <td>BoltzMol-1 structure confidence</td>
              <td style="text-align:right">0.00</td>
              <td style="text-align:right">~0.1</td>
              <td>Cloud API; local CPU used only for downloading/merging results. Initial 501-molecule screen ~$12.5; retry of 33 missing/failed molecules ~$0.83.</td>
            </tr>
            <tr>
              <td>Patent-risk screening</td>
              <td style="text-align:right">0.00</td>
              <td style="text-align:right">negligible</td>
              <td>Local substructure and scaffold searches against WO2018226155A1 claims.</td>
            </tr>
            <tr>
              <td>Integrated ranking and report generation</td>
              <td style="text-align:right">0.00</td>
              <td style="text-align:right">negligible</td>
              <td>Aggregation, scoring, t-SNE, and figure generation on a local workstation.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>SLURM totals</strong> (all jobs, including failed/discarded runs): <strong>249.37 CPU core-hours + 28.54 GPU card-hours</strong>. The successfully completed <code>ampc-*</code> jobs consumed <strong>167.05 CPU core-hours + 18.45 GPU card-hours</strong>. <strong>Storage</strong>: the project directory is ~33 GB. <strong>Cloud costs</strong>: BoltzMol-1 API was ~$13.3. These figures do not include method development, environment setup, or the local workstation used for Vina and report generation.
      </p>
    </section>
  </main>

  <footer>
    <p>Generated by the AMPC integrated analysis pipeline · {summary['date']}</p>
  </footer>

  {TABLE_SORT_SCRIPT}
</body>
</html>"""
    (outdir / "index.html").write_text(html, encoding="utf-8")

    # -----------------------------------------------------------------------
    # Standalone candidate table page
    # -----------------------------------------------------------------------
    css_path = Path(__file__).resolve().parent.parent / 'static' / 'style.css'
    css = css_path.read_text(encoding='utf-8')
    table_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AMPC Candidate Table · {summary['date']}</title>
  <style>
    {css}
    /* Full-width table layout */
    main {{ max-width: 100%; padding: 0; }}
    section {{ border-radius: 0; box-shadow: none; padding: 0.75rem; margin-bottom: 0; }}
    .table-wrap {{ margin: 0; border: none; border-radius: 0; max-height: none; }}
    .candidate-table {{ min-width: 100%; }}
  </style>
</head>
<body>
  <header>
    <h1>AMPC Candidate Table</h1>
    <p class="subtitle">500 generated candidates + AMPC reference · {summary['date']}</p>
  </header>

  <main>
    <section id="top-candidates">
      <h2>All Candidate Molecules (n = {summary['n_total'] + 1})</h2>
      <p>
        Click any column header for sort and filter options. Red = better, white = middle, blue = worse.
        Values better than AMPC are bold and underlined.
      </p>
      <p>
        <strong>*</strong> Molecules that were initially filtered by BoltzMol-1's internal SMARTS catalog and later retried with <code>boltz_smarts_catalog_filter_level=disabled</code> are marked with an asterisk in the Rank column.
      </p>

      <div id="filter-status" class="filter-status" style="display:none;"></div>

      <div class="table-wrap">
        <table class="candidate-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Structure</th>
              <th>MW (Da)</th>
              <th>Source</th>
              <th>GNINA CNN</th>
              <th>Vina (kcal/mol)</th>
              <th>ADMET tier</th>
              <th>Boltz confidence</th>
              <th>Patent risk</th>
              <th>Structural alerts</th>
              <th title="Synthetic accessibility score (lower = easier to synthesize)">SA score</th>
              <th>Composite score</th>
              <th>Integrated score</th>
            </tr>
          </thead>
          <tbody>
            {full_rows}
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <footer>
    <p>Generated by the AMPC integrated analysis pipeline · {summary['date']}</p>
  </footer>

  {TABLE_SORT_SCRIPT}
</body>
</html>"""
    (outdir / "table.html").write_text(table_html, encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    args = parse_args()
    outdir = Path(args.output_dir)
    imgdir = outdir / "images"
    datadir = outdir / "data"
    scriptdir = outdir / "scripts"
    for d in (outdir, imgdir, datadir, scriptdir, outdir / "static"):
        d.mkdir(parents=True, exist_ok=True)

    df, ampc_smiles = load_data(args)
    df = add_molecules(df)

    figures = {}

    print("[0/12] Rendering per-molecule structure images")
    molecule_images = render_molecule_images(df, size=(180, 135))

    print("[1/12] ADMET tier distribution")
    plot_admet_tiers(df, imgdir)
    figures["admet"] = imgdir / "admet_tier_distribution.png"

    print("[3/12] Patent risk counts")
    plot_patent_risk_counts(df, imgdir)
    figures["patent_counts"] = imgdir / "patent_risk_counts.png"

    print("[3.5/12] Patent risk by source")
    plot_patent_risk_by_source(df, imgdir)
    figures["patent_by_source"] = imgdir / "patent_risk_by_source.png"

    print("[3.6/12] Structural alerts")
    plot_structural_alerts(df, imgdir)
    figures["structural_alerts"] = imgdir / "structural_alerts.png"

    print("[4/12] Property distributions")
    plot_property_distributions(df, imgdir)
    figures["props"] = imgdir / "property_distributions.png"

    print("[5/12] Properties by source")
    plot_properties_by_source(df, imgdir)
    figures["props_source"] = imgdir / "properties_by_source.png"

    print("[5.5/12] ADMET tier by source")
    plot_admet_tier_by_source(df, imgdir)
    figures["admet_tier_by_source"] = imgdir / "admet_tier_by_source.png"

    print("[5.6/12] BoltzMol-1 workflow and distribution")
    plot_boltz_workflow(imgdir)
    figures["boltz_workflow"] = imgdir / "boltz_workflow.png"
    plot_boltz_distribution(imgdir)
    figures["boltz_distribution"] = imgdir / "boltz_distribution.png"

    print("[6/12] Correlation heatmap")
    plot_correlation_heatmap(df, imgdir)
    figures["corr"] = imgdir / "correlation_heatmap.png"

    print("[8/12] t-SNE projection")
    plot_tsne_properties(df, imgdir)
    figures["tsne"] = imgdir / "tsne_projection.png"
    figures["tsne_properties"] = imgdir / "tsne_properties.png"

    print("[9/12] AMPC reference")
    figures["ampc"] = draw_ampc_reference(ampc_smiles, imgdir)

    print("[10/12] Model variants table")
    plot_model_variants(imgdir)
    figures["variants"] = imgdir / "model_variants.png"

    print("[11/12] Filter funnel")
    plot_filter_funnel(imgdir)
    figures["funnel"] = imgdir / "filter_funnel.png"

    print("[12/12] Source balance")
    clustered_path = Path(args.candidates).parent / "candidates_clustered.csv"
    plot_source_balance(clustered_path, args.candidates, imgdir)
    figures["source_balance"] = imgdir / "source_balance.png"

    from datetime import datetime

    candidates_df = df[df["best_source"] != "AMPC_reference"]
    summary = {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "n_total": len(candidates_df),
        "n_top_tier": int((candidates_df["admet_tier_score"] >= 2).sum()),
        "n_low_risk": int((candidates_df["patent_risk_level"].isin(["Low", "Low-Medium"])).sum()),
        "n_high_risk": int((candidates_df["patent_risk_level"] == "High").sum()),
        "top_n": args.top_n,
    }

    top_table = candidates_df.nsmallest(args.top_n, "overall_rank")[
        ["overall_rank", "best_source", "composite_score", "integrated_score", "admet_tier_score", "patent_risk_level", "gnina_cnn_affinity", "vina_top_affinity", "mw"]
    ].copy()
    top_table.to_csv(datadir / "top_candidates.csv", index=False)

    (datadir / "report_data.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("Building HTML report...")
    pipeline_html = generate_pipeline_html()

    # Source counts for the Filtering Funnel input-sources table
    SOURCE_DESCRIPTIONS = {
        "varA_s1_gt0.6": "RL variant A stage 1, conservative AMPC-likeness reward, source score > 0.6",
        "varB_s1_gt0.6": "RL variant B stage 1, similarity/scaffold balance, source score > 0.6",
        "varB_s2": "RL variant B stage 2, relaxed Tanimoto for scaffold exploration",
        "varC_s2": "RL variant C stage 2, aggressive scaffold hopping with false-positive blacklist",
        "varD_full": "RL variant D full production run, full reward including QED/MW/LogP/SA/TPSA/rotors",
        "mol2mol_sim500k": "Mol2Mol similarity prior production run (500k samples, 3,397 valid unique)",
    }

    # Counts at each funnel stage
    reinvention_out = Path(args.candidates).resolve().parent.parent  # REINVENT4/output
    SOURCE_INPUT_FILES = {
        "varA_s1_gt0.6": ["rl_ampc_a100_varA_1.csv"],
        "varB_s1_gt0.6": ["rl_ampc_a100_varB_1.csv"],
        "varB_s2": ["rl_ampc_a100_varB_2.csv"],
        "varC_s2": ["rl_ampc_a100_varC_2.csv"],
        "varD_full": ["rl_ampc_a100_varD_full_1.csv", "rl_ampc_a100_varD_full_2.csv"],
    }

    source_input_counts = {}
    for src, files in SOURCE_INPUT_FILES.items():
        source_input_counts[src] = sum(count_csv_rows(reinvention_out / f) for f in files)
    # Mol2Mol production run sampled 500k molecules, of which 3,397 were valid unique
    source_input_counts["mol2mol_sim500k"] = 3_397

    raw_path = Path(args.candidates).parent / "candidates_raw.csv"
    after_filter_counts = {}
    if raw_path.is_file():
        after_filter_counts = pd.read_csv(raw_path, usecols=["source"])["source"].value_counts().to_dict()

    dedup_path = Path(args.candidates).parent / "candidates_deduplicated.csv"
    after_dedup_counts = {}
    if dedup_path.is_file():
        after_dedup_counts = pd.read_csv(dedup_path, usecols=["best_source"])["best_source"].value_counts().to_dict()

    cluster_path = Path(args.candidates).parent / "candidates_clustered.csv"
    after_cluster_counts = {}
    if cluster_path.is_file():
        after_cluster_counts = pd.read_csv(cluster_path, usecols=["best_source"])["best_source"].value_counts().to_dict()

    top500_for_counts = pd.read_csv(args.candidates)
    final_counts = top500_for_counts["best_source"].value_counts().to_dict()

    source_rows = "\n".join(
        f"          <tr><td><code>{src}</code></td><td>{desc}</td>"
        f"<td>{source_input_counts.get(src, 0):,}</td>"
        f"<td>{after_filter_counts.get(src, 0):,}</td>"
        f"<td>{after_dedup_counts.get(src, 0):,}</td>"
        f"<td>{after_cluster_counts.get(src, 0):,}</td>"
        f"<td>{final_counts.get(src, 0)}</td></tr>"
        for src, desc in SOURCE_DESCRIPTIONS.items()
    )

    build_html(outdir, figures, df, molecule_images, summary, pipeline_html, source_rows)

    print(f"Done. Report written to: {outdir.resolve() / 'index.html'}")


if __name__ == "__main__":
    main()
