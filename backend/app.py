"""
PharmaTrace Survival Analysis Backend v2.1
--------------------------------------------
Flask API for real-time survival analysis with:
  - Full 33 TCGA cancer types
  - OS / DFS / PFS / DSS survival metrics
  - MSigDB gene set integration (13,085 cancer genes from C6+H+C2)
  - DepMap gene dependency integration
  - cBioPortal REST API for real TCGA data

API Endpoints:
  POST /api/survival/forward   - Forward: gene + cancer → KM + HR + p-value
  POST /api/survival/reverse   - Reverse: cancer + MSigDB set → prognostic genes
  POST /api/survival/multi     - Multi-gene: several genes at once
  GET  /api/msigdb/categories  - List MSigDB categories
  GET  /api/msigdb/genes       - Get genes from MSigDB category
  GET  /api/msigdb/search      - Search MSigDB gene sets
  GET  /api/depmap/dependency  - DepMap: gene dependency scores
  GET  /api/cancers            - List 33 cancer studies
  GET  /api/health             - Health check
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import numpy as np
import pandas as pd
from lifelines import KaplanMeierFitter, CoxPHFitter
from lifelines.statistics import logrank_test
import time
from msigdb_direct import (
    get_gene_sets, get_all_genes, get_genes_for_reverse,
    get_master_cancer_gene_list, get_categories_info, search_sets,
    CATEGORY_INFO
)

app = Flask(__name__)
CORS(app)

# ============== Configuration ==============
CBIOPORTAL_BASE = "https://www.cbioportal.org/api"
DEPMAP_BASE = "https://depmap.org/portal/api"

# ============== 33 TCGA Cancer Studies ==============
CANCER_STUDIES = {
    "BRCA":  "brca_tcga_pan_can_atlas_2018",
    "LUAD":  "luad_tcga_pan_can_atlas_2018",
    "LUSC":  "lusc_tcga_pan_can_atlas_2018",
    "COAD":  "coadread_tcga_pan_can_atlas_2018",
    "READ":  "coadread_tcga_pan_can_atlas_2018",
    "STAD":  "stad_tcga_pan_can_atlas_2018",
    "HNSC":  "hnsc_tcga_pan_can_atlas_2018",
    "BLCA":  "blca_tcga_pan_can_atlas_2018",
    "KIRC":  "kirc_tcga_pan_can_atlas_2018",
    "KIRP":  "kirp_tcga_pan_can_atlas_2018",
    "KICH":  "kich_tcga_pan_can_atlas_2018",
    "LIHC":  "lihc_tcga_pan_can_atlas_2018",
    "CHOL":  "chol_tcga_pan_can_atlas_2018",
    "PAAD":  "paad_tcga_pan_can_atlas_2018",
    "ESCA":  "esca_tcga_pan_can_atlas_2018",
    "CESC":  "cesc_tcga_pan_can_atlas_2018",
    "OV":    "ov_tcga_pan_can_atlas_2018",
    "UCEC":  "ucec_tcga_pan_can_atlas_2018",
    "UCS":   "ucs_tcga_pan_can_atlas_2018",
    "THCA":  "thca_tcga_pan_can_atlas_2018",
    "PRAD":  "prad_tcga_pan_can_atlas_2018",
    "SKCM":  "skcm_tcga_pan_can_atlas_2018",
    "SARC":  "sarc_tcga_pan_can_atlas_2018",
    "LGG":   "lgggbm_tcga_pan_can_atlas_2018",
    "GBM":   "lgggbm_tcga_pan_can_atlas_2018",
    "UVM":   "uvm_tcga_pan_can_atlas_2018",
    "ACC":   "acc_tcga_pan_can_atlas_2018",
    "PCPG":  "pcpg_tcga_pan_can_atlas_2018",
    "MESO":  "meso_tcga_pan_can_atlas_2018",
    "TGCT":  "tgct_tcga_pan_can_atlas_2018",
    "DLBC":  "dlbc_tcga_pan_can_atlas_2018",
    "THYM":  "thym_tcga_pan_can_atlas_2018",
    "LAML":  "laml_tcga_pan_can_atlas_2018",
}

CANCER_NAMES = {
    "BRCA": "乳腺浸润癌", "LUAD": "肺腺癌", "LUSC": "肺鳞癌",
    "COAD": "结肠腺癌", "READ": "直肠腺癌", "STAD": "胃癌",
    "HNSC": "头颈鳞癌", "BLCA": "膀胱尿路上皮癌", "KIRC": "肾透明细胞癌",
    "KIRP": "肾乳头状细胞癌", "KICH": "肾嫌色细胞癌", "LIHC": "肝细胞癌",
    "CHOL": "胆管癌", "PAAD": "胰腺腺癌", "ESCA": "食管癌",
    "CESC": "宫颈鳞癌", "OV": "卵巢浆液性囊腺癌", "UCEC": "子宫内膜癌",
    "UCS": "子宫癌肉瘤", "THCA": "甲状腺癌", "PRAD": "前列腺腺癌",
    "SKCM": "皮肤黑色素瘤", "SARC": "肉瘤", "LGG": "低级别胶质瘤",
    "GBM": "胶质母细胞瘤", "UVM": "葡萄膜黑色素瘤", "ACC": "肾上腺皮质癌",
    "PCPG": "嗜铬细胞瘤和副神经节瘤", "MESO": "间皮瘤", "TGCT": "睾丸生殖细胞肿瘤",
    "DLBC": "弥漫性大B细胞淋巴瘤", "THYM": "胸腺瘤", "LAML": "急性髓系白血病",
}

# ============== MSigDB Gene Sets ==============
def cbio_get(endpoint, params=None, timeout=30):
    url = f"{CBIOPORTAL_BASE}{endpoint}"
    try:
        r = requests.get(url, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}


def get_molecular_profile_id(study_id):
    """Get RNA-seq molecular profile ID (auto-discover if not in map)."""
    profiles = cbio_get(f"/studies/{study_id}/molecular-profiles", timeout=30)
    if isinstance(profiles, list):
        for p in profiles:
            name = p.get("molecularProfileId", "")
            dn = p.get("name", "").lower()
            if "rna seq" in dn and "mrna" in dn and "z-scores" in dn:
                return name
            if "rna_seq" in name.lower() and "mrna" in name.lower():
                return name
    return None


def get_clinical_data(study_id):
    """Fetch patient clinical data including OS, DFS, PFS, DSS."""
    data = cbio_get(
        f"/studies/{study_id}/clinical-data",
        {"clinicalDataType": "PATIENT", "projection": "DETAILED", "pageSize": 10000},
        timeout=30
    )
    if not isinstance(data, list):
        return {}
    patients = {}
    for item in data:
        pid = item.get("patientId", "")
        attr = item.get("clinicalAttributeId", "")
        val = item.get("value", "")
        if pid not in patients:
            patients[pid] = {}
        patients[pid][attr] = val
    return patients


def get_samples(study_id):
    samples = cbio_get(f"/studies/{study_id}/samples", {"pageSize": 10000}, timeout=30)
    return samples if isinstance(samples, list) else []


def get_gene_expression(study_id, profile_id, gene):
    """Fetch expression data for a gene via cBioPortal molecular-data API."""
    genes = cbio_get("/genes", {"keyword": gene, "pageSize": 1}, timeout=30)
    if not (isinstance(genes, list) and len(genes) > 0):
        return None, gene
    entrez_id = genes[0].get("entrezGeneId")
    gene_name = genes[0].get("hugoGeneSymbol", gene)

    body = {
        "sampleListId": f"{study_id}_all",
        "entrezGeneIds": [entrez_id]
    }
    try:
        r = requests.post(
            f"{CBIOPORTAL_BASE}/molecular-profiles/{profile_id}/molecular-data/fetch",
            json=body,
            timeout=120
        )
        r.raise_for_status()
        return r.json(), gene_name
    except Exception:
        return None, gene


# ============== Survival Analysis Core ==============

def parse_survival(patients, sample_to_patient):
    """Parse clinical data into DataFrame with OS/DFS/PFS/DSS columns."""
    rows = []
    for sample_id, patient_id in sample_to_patient.items():
        p = patients.get(patient_id, {})

        def parse_float(v):
            try:
                return float(v) if v not in (None, "", "NA", "N/A") else None
            except (ValueError, TypeError):
                return None

        def parse_event(status, event_keywords):
            if not status:
                return 0
            s = str(status).upper().strip()
            if any(k in s for k in event_keywords):
                return 1
            return 0

        os_m = parse_float(p.get("OS_MONTHS"))
        dfs_m = parse_float(p.get("DFS_MONTHS"))
        pfs_m = parse_float(p.get("PFS_MONTHS"))
        dss_m = parse_float(p.get("DSS_MONTHS"))

        os_status = p.get("OS_STATUS", "")
        dfs_status = p.get("DFS_STATUS", "")
        pfs_status = p.get("PFS_STATUS", "")
        dss_status = p.get("DSS_STATUS", "")

        rows.append({
            "sample_id": sample_id,
            "patient_id": patient_id,
            "OS_MONTHS": os_m,
            "OS_EVENT":  parse_event(os_status, ["DECEASED", "DEAD", "1"]),
            "DFS_MONTHS": dfs_m,
            "DFS_EVENT": parse_event(dfs_status, ["PROGRESSION", "RECUR", "RECURRENCE", "1:PROGRESSION", "1:RECUR"]),
            "PFS_MONTHS": pfs_m,
            "PFS_EVENT": parse_event(pfs_status, ["PROGRESSION", "RECUR", "RECURRENCE", "1:PROGRESSION", "1:RECUR"]),
            "DSS_MONTHS": dss_m,
            "DSS_EVENT": parse_event(dss_status, ["DEAD", "DECEASED", "1"]),
        })
    return pd.DataFrame(rows)


def compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type="OS", cutoff=50):
    """
    Compute Cox regression + Log-rank + KM curves for a gene.
    survival_type: OS | DFS | PFS | DSS
    """
    if not expr_data or not isinstance(expr_data, list) or len(expr_data) == 0:
        return None

    expr_rows = []
    for item in expr_data:
        sid = item.get("sampleId", "")
        val = item.get("value")
        if val is not None:
            try:
                expr_rows.append({"sample_id": sid, "expression": float(val)})
            except (ValueError, TypeError):
                pass

    if len(expr_rows) < 20:
        return None

    expr_df = pd.DataFrame(expr_rows)
    merged = clinical_df.merge(expr_df, on="sample_id", how="inner")
    if len(merged) < 20:
        return None

    # Map survival type to columns
    survival_map = {
        "DFS": ("DFS_MONTHS", "DFS_EVENT"),
        "PFS": ("PFS_MONTHS", "PFS_EVENT"),
        "DSS": ("DSS_MONTHS", "DSS_EVENT"),
        "OS":  ("OS_MONTHS",  "OS_EVENT"),
    }
    time_col, event_col = survival_map.get(survival_type, ("OS_MONTHS", "OS_EVENT"))

    merged = merged.dropna(subset=[time_col, event_col, "expression"])
    if len(merged) < 20:
        return None

    # Group by cutoff
    threshold = merged["expression"].quantile(cutoff / 100.0)
    merged["group"] = (merged["expression"] >= threshold).astype(int)

    high_group = merged[merged["group"] == 1]
    low_group = merged[merged["group"] == 0]
    high_n = len(high_group)
    low_n = len(low_group)

    if high_n < 5 or low_n < 5:
        return None

    # Log-rank test
    try:
        lr = logrank_test(
            high_group[time_col], low_group[time_col],
            event_observed_A=high_group[event_col],
            event_observed_B=low_group[event_col]
        )
        p_value = lr.p_value
    except Exception:
        p_value = 1.0

    # Cox regression
    try:
        cox_df = merged[[time_col, event_col, "group"]].copy()
        cph = CoxPHFitter()
        cph.fit(cox_df, duration_col=time_col, event_col=event_col)
        hr = float(np.exp(cph.params_["group"]))
        ci_vals = np.exp(cph.confidence_intervals_.loc["group"].values)
        hr_ci_low, hr_ci_high = float(ci_vals[0]), float(ci_vals[1])
    except Exception:
        hr, hr_ci_low, hr_ci_high = 1.0, 0.5, 2.0
        p_value = 1.0

    # KM curves
    kmf_high = KaplanMeierFitter()
    kmf_low = KaplanMeierFitter()
    kmf_high.fit(high_group[time_col], event_observed=high_group[event_col], label=f"High {gene_name}")
    kmf_low.fit(low_group[time_col], event_observed=low_group[event_col], label=f"Low {gene_name}")

    high_median = kmf_high.median_survival_time_
    low_median = kmf_low.median_survival_time_

    km_data = {
        "high": {
            "time": [float(t) for t in kmf_high.survival_function_.index.tolist()],
            "survival": [float(s) for s in kmf_high.survival_function_.iloc[:, 0].tolist()]
        },
        "low": {
            "time": [float(t) for t in kmf_low.survival_function_.index.tolist()],
            "survival": [float(s) for s in kmf_low.survival_function_.iloc[:, 0].tolist()]
        }
    }

    return {
        "gene": gene_name,
        "survival_type": survival_type,
        "hr": hr,
        "hr_ci_low": hr_ci_low,
        "hr_ci_high": hr_ci_high,
        "p_value": float(p_value),
        "high_n": high_n,
        "low_n": low_n,
        "high_median": float(high_median) if not np.isnan(high_median) else None,
        "low_median": float(low_median) if not np.isnan(low_median) else None,
        "high_events": int(high_group[event_col].sum()),
        "low_events": int(low_group[event_col].sum()),
        "km_data": km_data,
        "data_source": "cBioPortal/TCGA"
    }


# ============== DepMap Integration ==============

def fetch_depmap_dependency(gene):
    """Fetch gene dependency scores from DepMap API."""
    try:
        # DepMap uses a gene search endpoint
        # First resolve gene to their entity ID
        search_url = f"{DEPMAP_BASE}/gene/{gene}"
        r = requests.get(search_url, timeout=30)
        if r.status_code != 200:
            return None
        gene_info = r.json()
        gene_id = gene_info.get("geneId") or gene_info.get("entityId")
        if not gene_id:
            return None

        # Fetch dependency data
        dep_url = f"{DEPMAP_BASE}/gene/{gene_id}/dependency"
        r2 = requests.get(dep_url, timeout=60)
        if r2.status_code != 200:
            return None
        deps = r2.json()
        return deps
    except Exception as e:
        return {"error": str(e)}


# ============== API Routes ==============

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "PharmaTrace Survival Analysis API v2.0",
        "features": ["33 TCGA cancer types", "OS/DFS/PFS/DSS", "2000 genes", "DepMap"]
    })


@app.route("/api/cancers", methods=["GET"])
def list_cancers():
    """List all 33 TCGA cancer studies with Chinese names."""
    studies = []
    for code, study_id in CANCER_STUDIES.items():
        name = CANCER_NAMES.get(code, code)
        studies.append({
            "code": code,
            "name": f"{code} - {name}",
            "study_id": study_id
        })
    return jsonify({"studies": studies, "count": len(studies)})


@app.route("/api/survival/forward", methods=["POST"])
def forward_analysis():
    """
    Forward analysis: gene + cancer → survival results.
    Body: { gene, cancer_type, survival_type="OS", cutoff=50 }
    """
    data = request.get_json() or {}
    gene = data.get("gene", "").upper().strip()
    cancer_code = data.get("cancer_type", "").upper().strip()
    survival_type = data.get("survival_type", "OS").upper()
    cutoff = int(data.get("cutoff", 50))

    if not gene or not cancer_code:
        return jsonify({"error": "gene and cancer_type are required"}), 400

    study_id = CANCER_STUDIES.get(cancer_code)
    if not study_id:
        return jsonify({"error": f"Unknown cancer type: {cancer_code}"}), 400

    if survival_type not in ("OS", "DFS", "PFS", "DSS"):
        return jsonify({"error": "survival_type must be OS, DFS, PFS, or DSS"}), 400

    profile_id = get_molecular_profile_id(study_id)
    if not profile_id:
        return jsonify({"error": "No RNA-seq data for this cancer type"}), 404

    samples = get_samples(study_id)
    if not samples:
        return jsonify({"error": "No samples found"}), 404

    sample_to_patient = {s["sampleId"]: s.get("patientId", s["sampleId"]) for s in samples}
    patients = get_clinical_data(study_id)
    clinical_df = parse_survival(patients, sample_to_patient)
    if len(clinical_df) < 20:
        return jsonify({"error": "Insufficient clinical data"}), 404

    expr_data, gene_name = get_gene_expression(study_id, profile_id, gene)
    if not expr_data:
        return jsonify({"error": f"No expression data for gene {gene}"}), 404

    result = compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type, cutoff)
    if not result:
        return jsonify({"error": "Analysis failed after data filtering"}), 400

    return jsonify(result)


@app.route("/api/survival/reverse", methods=["POST"])
def reverse_analysis():
    """
    Reverse analysis: cancer → ranked prognostic gene list.
    Body: { cancer_type, survival_type="OS", cutoff=50, max_genes=200, msigdb_category="C6" }
    msigdb_category: H/C2/C3/C5/C6/C7/C8 (default: C6 Oncogenic)
    """
    data = request.get_json() or {}
    cancer_code = data.get("cancer_type", "").upper().strip()
    survival_type = data.get("survival_type", "OS").upper()
    cutoff = int(data.get("cutoff", 50))
    max_genes = int(data.get("max_genes", 200))
    msigdb_category = data.get("msigdb_category", "C6").upper()

    if not cancer_code:
        return jsonify({"error": "cancer_type is required"}), 400

    study_id = CANCER_STUDIES.get(cancer_code)
    if not study_id:
        return jsonify({"error": f"Unknown cancer type: {cancer_code}"}), 400

    if survival_type not in ("OS", "DFS", "PFS", "DSS"):
        return jsonify({"error": "survival_type must be OS, DFS, PFS, or DSS"}), 400

    profile_id = get_molecular_profile_id(study_id)
    if not profile_id:
        return jsonify({"error": "No RNA-seq data"}), 404

    samples = get_samples(study_id)
    if not samples:
        return jsonify({"error": "No samples found"}), 404

    sample_to_patient = {s["sampleId"]: s.get("patientId", s["sampleId"]) for s in samples}
    patients = get_clinical_data(study_id)
    clinical_df = parse_survival(patients, sample_to_patient)
    if len(clinical_df) < 20:
        return jsonify({"error": "Insufficient clinical data"}), 404

    # Get gene list from MSigDB
    msigdb_result = get_genes_for_reverse(
        category=msigdb_category,
        max_sets=200 if msigdb_category in ("C2", "C5", "C7", "C8") else None
    )
    if "error" in msigdb_result:
        return jsonify({"error": msigdb_result["error"]}), 500
    
    all_genes = msigdb_result.get("genes", [])
    if not all_genes:
        return jsonify({"error": f"No genes found in MSigDB category {msigdb_category}"}), 404
    
    # Limit to max_genes
    genes_to_test = all_genes[:min(max_genes, len(all_genes))]
    results = []

    for i, gene in enumerate(genes_to_test):
        expr_data, gene_name = get_gene_expression(study_id, profile_id, gene)
        if not expr_data:
            continue

        result = compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type, cutoff)
        if result and result["p_value"] < 0.05:
            results.append(result)

        if (i + 1) % 20 == 0:
            time.sleep(0.1)  # Rate limiting

    results.sort(key=lambda x: x["p_value"])
    for i, r in enumerate(results):
        r["rank"] = i + 1

    return jsonify({
        "cancer_type": cancer_code,
        "survival_type": survival_type,
        "cutoff": cutoff,
        "msigdb_category": msigdb_category,
        "msigdb_category_name": CATEGORY_INFO.get(msigdb_category, {}).get("name", msigdb_category),
        "total_tested": len(genes_to_test),
        "significant_genes": len(results),
        "genes": results,
        "data_source": "cBioPortal/TCGA + MSigDB",
        "gene_source": msigdb_result.get("source", "MSigDB")
    })


@app.route("/api/survival/multi", methods=["POST"])
def multi_gene_analysis():
    """
    Analyze multiple genes at once.
    Body: { genes: ["TP53", "EGFR"], cancer_type, survival_type="OS", cutoff=50 }
    """
    data = request.get_json() or {}
    genes = data.get("genes", [])
    cancer_code = data.get("cancer_type", "").upper().strip()
    survival_type = data.get("survival_type", "OS").upper()
    cutoff = int(data.get("cutoff", 50))

    if not genes or not cancer_code:
        return jsonify({"error": "genes and cancer_type are required"}), 400

    study_id = CANCER_STUDIES.get(cancer_code)
    if not study_id:
        return jsonify({"error": f"Unknown cancer type: {cancer_code}"}), 400

    profile_id = get_molecular_profile_id(study_id)
    if not profile_id:
        return jsonify({"error": "No RNA-seq data"}), 404

    samples = get_samples(study_id)
    sample_to_patient = {s["sampleId"]: s.get("patientId", s["sampleId"]) for s in samples}
    patients = get_clinical_data(study_id)
    clinical_df = parse_survival(patients, sample_to_patient)

    results = []
    for gene in genes[:20]:  # Max 20 genes at once
        expr_data, gene_name = get_gene_expression(study_id, profile_id, gene)
        if expr_data:
            result = compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type, cutoff)
            if result:
                results.append(result)
        time.sleep(0.05)

    results.sort(key=lambda x: x["p_value"])
    return jsonify({
        "cancer_type": cancer_code,
        "survival_type": survival_type,
        "genes_analyzed": len(results),
        "results": results,
        "data_source": "cBioPortal/TCGA"
    })


@app.route("/api/depmap/dependency", methods=["GET"])
def depmap_dependency():
    """
    Get DepMap gene dependency data.
    Query: ?gene=TP53
    """
    gene = request.args.get("gene", "").upper().strip()
    if not gene:
        return jsonify({"error": "gene parameter required"}), 400

    result = fetch_depmap_dependency(gene)
    if result is None:
        return jsonify({"error": f"No DepMap data for gene {gene}"}), 404
    if isinstance(result, dict) and "error" in result:
        return jsonify(result), 500

    return jsonify({"gene": gene, "dependency": result, "source": "DepMap Portal"})


@app.route("/api/msigdb/categories", methods=["GET"])
def msigdb_categories():
    """List available MSigDB categories with gene counts."""
    info = get_categories_info()
    return jsonify({
        "categories": info,
        "available": list(CATEGORY_INFO.keys()),
        "default": "C6",
        "note": "Use category code (e.g., C6, H) in /api/survival/reverse as msigdb_category"
    })


@app.route("/api/msigdb/genes", methods=["GET"])
def msigdb_genes():
    """
    Get all genes from an MSigDB category.
    Query: ?category=C6&max_sets=50
    """
    category = request.args.get("category", "C6").upper()
    max_sets = request.args.get("max_sets", type=int)
    
    if category not in CATEGORY_INFO:
        return jsonify({"error": f"Unknown category: {category}. Use: {list(CATEGORY_INFO.keys())}"}), 400
    
    result = get_genes_for_reverse(category=category, max_sets=max_sets)
    if "error" in result:
        return jsonify(result), 500
    
    return jsonify({
        "category": category,
        "category_name": result["category_name"],
        "total_genes": result["total_genes"],
        "num_sets": result["num_sets_used"],
        "sample_genes": result["genes"][:50],
        "source": result["source"]
    })


@app.route("/api/msigdb/search", methods=["GET"])
def msigdb_search():
    """
    Search MSigDB gene sets by keyword.
    Query: ?keyword=CANCER&category=C2
    """
    keyword = request.args.get("keyword", "").strip()
    category = request.args.get("category", "C6").upper()
    
    if not keyword:
        return jsonify({"error": "keyword parameter required"}), 400
    
    matches = search_sets(keyword, category)
    return jsonify({
        "keyword": keyword,
        "category": category,
        "matches_found": len(matches),
        "matches": matches,
        "source": "MSigDB"
    })


@app.route("/api/genes", methods=["GET"])
def list_genes():
    """Return the master cancer gene list from MSigDB."""
    master = get_master_cancer_gene_list()
    return jsonify({
        "total_genes": master["total_genes"],
        "sample_genes": master["genes"][:100],
        "sources": master["sources"],
        "source": master["source"],
        "note": f"Full list: {master['total_genes']} genes from {len(master['sources'])} MSigDB sources"
    })


# ============== Main ==============
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
