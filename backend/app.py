"""
PharmaTrace Survival Analysis Backend
-------------------------------------
Flask API for real-time survival analysis using cBioPortal/TCGA data.

API Endpoints:
  POST /api/survival/forward  - Forward analysis: gene + cancer → survival
  POST /api/survival/reverse  - Reverse analysis: cancer → prognostic genes
  GET  /api/cancers           - List available cancer studies
  GET  /api/health            - Health check
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import numpy as np
import pandas as pd
from lifelines import KaplanMeierFitter, CoxPHFitter
from lifelines.statistics import logrank_test
import json
import time

app = Flask(__name__)
CORS(app)

# ============== cBioPortal API Client ==============
CBIOPORTAL_BASE = "https://www.cbioportal.org/api"

# TCGA cancer study ID mapping
CANCER_STUDIES = {
    "BRCA": "brca_tcga_pan_can_atlas_2018",
    "LUAD": "luad_tcga_pan_can_atlas_2018",
    "LUSC": "lusc_tcga_pan_can_atlas_2018",
    "COAD": "coadread_tcga_pan_can_atlas_2018",
    "STAD": "stad_tcga_pan_can_atlas_2018",
    "HNSC": "hnsc_tcga_pan_can_atlas_2018",
    "BLCA": "blca_tcga_pan_can_atlas_2018",
    "KIRC": "kirc_tcga_pan_can_atlas_2018",
    "KIRP": "kirp_tcga_pan_can_atlas_2018",
    "LIHC": "lihc_tcga_pan_can_atlas_2018",
    "CHOL": "chol_tcga_pan_can_atlas_2018",
    "PAAD": "paad_tcga_pan_can_atlas_2018",
    "ESCA": "esca_tcga_pan_can_atlas_2018",
    "CESC": "cesc_tcga_pan_can_atlas_2018",
    "OV": "ov_tcga_pan_can_atlas_2018",
    "UCEC": "ucec_tcga_pan_can_atlas_2018",
    "THCA": "thca_tcga_pan_can_atlas_2018",
    "PRAD": "prad_tcga_pan_can_atlas_2018",
    "SKCM": "skcm_tcga_pan_can_atlas_2018",
    "SARC": "sarc_tcga_pan_can_atlas_2018",
    "LGG": "lgggbm_tcga_pan_can_atlas_2018",
    "GBM": "lgggbm_tcga_pan_can_atlas_2018",
    "UVM": "uvm_tcga_pan_can_atlas_2018",
    "ACC": "acc_tcga_pan_can_atlas_2018",
    "PCPG": "pcpg_tcga_pan_can_atlas_2018",
    "MESO": "meso_tcga_pan_can_atlas_2018",
    "TGCT": "tgct_tcga_pan_can_atlas_2018",
    "DLBC": "dlbc_tcga_pan_can_atlas_2018",
    "THYM": "thym_tcga_pan_can_atlas_2018",
    "LAML": "laml_tcga_pan_can_atlas_2018",
}

# Molecular profile IDs for RNA-seq (Pan-Cancer Atlas)
MRNA_PROFILES = {
    "brca_tcga_pan_can_atlas_2018": "brca_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "luad_tcga_pan_can_atlas_2018": "luad_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "lusc_tcga_pan_can_atlas_2018": "lusc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "coadread_tcga_pan_can_atlas_2018": "coadread_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "stad_tcga_pan_can_atlas_2018": "stad_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "hnsc_tcga_pan_can_atlas_2018": "hnsc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "blca_tcga_pan_can_atlas_2018": "blca_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "kirc_tcga_pan_can_atlas_2018": "kirc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "kirp_tcga_pan_can_atlas_2018": "kirp_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "lihc_tcga_pan_can_atlas_2018": "lihc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "paad_tcga_pan_can_atlas_2018": "paad_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "esca_tcga_pan_can_atlas_2018": "esca_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "cesc_tcga_pan_can_atlas_2018": "cesc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "ov_tcga_pan_can_atlas_2018": "ov_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "ucec_tcga_pan_can_atlas_2018": "ucec_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "prad_tcga_pan_can_atlas_2018": "prad_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "skcm_tcga_pan_can_atlas_2018": "skcm_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "sarc_tcga_pan_can_atlas_2018": "sarc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "lgggbm_tcga_pan_can_atlas_2018": "lgggbm_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "dlbc_tcga_pan_can_atlas_2018": "dlbc_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
    "laml_tcga_pan_can_atlas_2018": "laml_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_all_sample_Zscores",
}

# Common cancer genes for reverse analysis
GENE_LIST = [
    "TP53", "EGFR", "BRCA1", "BRCA2", "KRAS", "PIK3CA", "PTEN", "MYC",
    "CDH1", "ERBB2", "VEGFA", "CDKN2A", "MLH1", "MSH2", "ATM", "CHEK2",
    "BCL2", "FOXM1", "CDK4", "MDM2", "RB1", "SMAD4", "APC", "CTNNB1",
    "CCND1", "CDK6", "ESR1", "AR", "FGFR1", "FGFR2", "MET", "ROS1",
    "ALK", "RET", "PD-L1", "CD274", "CTLA4", "STK11", "KEAP1", "ARID1A",
    "NOTCH1", "JAK1", "JAK2", "STAT3", "SOX2", "NANOG", "KLF4", "MYC",
    "BAP1", "PBRM1", "VHL", "KIT", "PDGFRA", "FLT3", "NPM1", "RUNX1",
    "DNMT3A", "TET2", "IDH1", "IDH2", "ASXL1", "EZH2", "SF3B1", "SRSF2",
]


def cbio_get(endpoint, params=None):
    """Make a GET request to cBioPortal API."""
    url = f"{CBIOPORTAL_BASE}{endpoint}"
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        return {"error": str(e)}


def get_molecular_profile_id(study_id):
    """Get the RNA-seq molecular profile ID for a study."""
    if study_id in MRNA_PROFILES:
        return MRNA_PROFILES[study_id]
    # Fallback: query API
    profiles = cbio_get(f"/studies/{study_id}/molecular-profiles")
    if isinstance(profiles, list):
        for p in profiles:
            name = p.get("molecularProfileId", "")
            if "rna_seq" in name.lower() and "mrna" in name.lower():
                return name
    return None


def get_clinical_data(study_id):
    """Fetch clinical survival data for a study."""
    # Get patient clinical data
    data = cbio_get(
        f"/studies/{study_id}/clinical-data",
        {"clinicalDataType": "PATIENT", "projection": "DETAILED", "pageSize": 10000}
    )
    if not isinstance(data, list):
        return []
    
    # Extract OS_MONTHS and OS_STATUS
    patients = {}
    for item in data:
        pid = item.get("patientId", "")
        attr = item.get("clinicalAttributeId", "")
        val = item.get("value", "")
        if pid not in patients:
            patients[pid] = {}
        patients[pid][attr] = val
    
    return patients


def get_gene_expression(study_id, molecular_profile_id, gene):
    """Fetch expression data for a specific gene using cBioPortal API."""
    # First get entrezGeneId from hugo symbol
    genes = cbio_get("/genes", {"keyword": gene, "pageSize": 1})
    if isinstance(genes, list) and len(genes) > 0:
        entrez_id = genes[0].get("entrezGeneId")
        gene_name = genes[0].get("hugoGeneSymbol", gene)
    else:
        return None, gene
    
    # Use profile-specific endpoint with sampleListId
    sample_list_id = f"{study_id}_all"
    body = {
        "sampleListId": sample_list_id,
        "entrezGeneIds": [entrez_id]
    }
    
    try:
        resp = requests.post(
            f"{CBIOPORTAL_BASE}/molecular-profiles/{molecular_profile_id}/molecular-data/fetch",
            json=body,
            timeout=120
        )
        resp.raise_for_status()
        return resp.json(), gene_name
    except Exception as e:
        return None, gene


def get_samples(study_id):
    """Get all sample IDs for a study."""
    samples = cbio_get(f"/studies/{study_id}/samples", {"pageSize": 10000})
    if isinstance(samples, list):
        return samples
    return []


# ============== Survival Analysis Core ==============

def parse_survival(patients, sample_to_patient):
    """Parse clinical data into survival DataFrame."""
    rows = []
    for sample_id, patient_id in sample_to_patient.items():
        p = patients.get(patient_id, {})
        os_months = p.get("OS_MONTHS")
        os_status = p.get("OS_STATUS")
        dfs_months = p.get("DFS_MONTHS")
        dfs_status = p.get("DFS_STATUS")
        
        try:
            os_m = float(os_months) if os_months else None
        except:
            os_m = None
        try:
            dfs_m = float(dfs_months) if dfs_months else None
        except:
            dfs_m = None
        
        os_event = 1 if os_status and "DECEASED" in str(os_status).upper() else 0
        dfs_event = 1 if dfs_status and str(dfs_status).upper() in ["1:PROGRESSION", "PROGRESSION", "RECURRANCE", "RECURRENCE"] else 0
        
        rows.append({
            "sample_id": sample_id,
            "patient_id": patient_id,
            "OS_MONTHS": os_m,
            "OS_EVENT": os_event,
            "DFS_MONTHS": dfs_m,
            "DFS_EVENT": dfs_event
        })
    
    return pd.DataFrame(rows)


def compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type="OS", cutoff=50):
    """
    Compute survival analysis for a single gene.
    
    Returns:
        dict with HR, CI, p-value, KM curve data, median survival
    """
    if not expr_data or not isinstance(expr_data, list) or len(expr_data) == 0:
        return None
    
    # Build expression DataFrame
    expr_rows = []
    for item in expr_data:
        sid = item.get("sampleId", "")
        val = item.get("value")
        if val is not None:
            try:
                expr_rows.append({"sample_id": sid, "expression": float(val)})
            except:
                pass
    
    if len(expr_rows) < 20:
        return None
    
    expr_df = pd.DataFrame(expr_rows)
    
    # Merge with clinical
    merged = clinical_df.merge(expr_df, on="sample_id", how="inner")
    if len(merged) < 20:
        return None
    
    # Determine time/event columns
    if survival_type == "DFS":
        time_col = "DFS_MONTHS"
        event_col = "DFS_EVENT"
    else:
        time_col = "OS_MONTHS"
        event_col = "OS_EVENT"
    
    # Remove missing
    merged = merged.dropna(subset=[time_col, event_col, "expression"])
    if len(merged) < 20:
        return None
    
    # Group by cutoff
    threshold = merged["expression"].quantile(cutoff / 100.0)
    merged["group"] = (merged["expression"] >= threshold).astype(int)
    
    # Basic stats
    high_group = merged[merged["group"] == 1]
    low_group = merged[merged["group"] == 0]
    
    high_n = len(high_group)
    low_n = len(low_group)
    
    if high_n < 5 or low_n < 5:
        return None
    
    # Log-rank test
    try:
        lr_result = logrank_test(
            high_group[time_col], low_group[time_col],
            event_observed_A=high_group[event_col],
            event_observed_B=low_group[event_col]
        )
        p_value = lr_result.p_value
    except Exception:
        p_value = 1.0
    
    # Cox regression
    try:
        cox_df = merged[[time_col, event_col, "group"]].copy()
        cph = CoxPHFitter()
        cph.fit(cox_df, duration_col=time_col, event_col=event_col)
        hr = np.exp(cph.params_["group"])
        ci = np.exp(cph.confidence_intervals_.loc["group"].values)
        hr_ci_low, hr_ci_high = float(ci[0]), float(ci[1])
    except Exception:
        hr = 1.0
        hr_ci_low, hr_ci_high = 0.5, 2.0
        p_value = 1.0
    
    # KM curves
    kmf_high = KaplanMeierFitter()
    kmf_low = KaplanMeierFitter()
    
    kmf_high.fit(high_group[time_col], event_observed=high_group[event_col], label=f"High {gene_name}")
    kmf_low.fit(low_group[time_col], event_observed=low_group[event_col], label=f"Low {gene_name}")
    
    # Median survival
    high_median = kmf_high.median_survival_time_
    low_median = kmf_low.median_survival_time_
    
    # KM curve data points
    km_data = {
        "high": {
            "time": kmf_high.survival_function_.index.tolist(),
            "survival": kmf_high.survival_function_.iloc[:, 0].tolist()
        },
        "low": {
            "time": kmf_low.survival_function_.index.tolist(),
            "survival": kmf_low.survival_function_.iloc[:, 0].tolist()
        }
    }
    
    return {
        "gene": gene_name,
        "survival_type": survival_type,
        "hr": float(hr),
        "hr_ci_low": float(hr_ci_low),
        "hr_ci_high": float(hr_ci_high),
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


# ============== API Routes ==============

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "PharmaTrace Survival Analysis API"})


@app.route("/api/cancers", methods=["GET"])
def list_cancers():
    """List available cancer studies."""
    return jsonify({
        "studies": [
            {"code": k, "name": v.replace("_tcga_pan_can_atlas_2018", "").upper() + " (TCGA)"}
            for k, v in CANCER_STUDIES.items()
        ]
    })


@app.route("/api/survival/forward", methods=["POST"])
def forward_analysis():
    """
    Forward survival analysis.
    Input: { gene, cancer_type, survival_type="OS", cutoff=50 }
    Output: survival analysis results with KM curve data
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
    
    # Get molecular profile
    profile_id = get_molecular_profile_id(study_id)
    if not profile_id:
        return jsonify({"error": "No RNA-seq data available for this cancer type"}), 404
    
    # Get samples
    samples = get_samples(study_id)
    if not samples:
        return jsonify({"error": "No samples found"}), 404
    
    sample_ids = [s["sampleId"] for s in samples]
    sample_to_patient = {s["sampleId"]: s.get("patientId", s["sampleId"]) for s in samples}
    
    # Get clinical data
    patients = get_clinical_data(study_id)
    clinical_df = parse_survival(patients, sample_to_patient)
    
    if len(clinical_df) < 20:
        return jsonify({"error": "Insufficient clinical data"}), 404
    
    # Get gene expression
    expr_data, gene_name = get_gene_expression(study_id, profile_id, gene)
    
    if not expr_data:
        return jsonify({"error": f"No expression data found for gene {gene}"}), 404
    
    # Compute survival analysis
    result = compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type, cutoff)
    
    if not result:
        return jsonify({"error": "Analysis failed - insufficient data after filtering"}), 400
    
    return jsonify(result)


@app.route("/api/survival/reverse", methods=["POST"])
def reverse_analysis():
    """
    Reverse survival analysis - screen all genes.
    Input: { cancer_type, survival_type="OS", cutoff=50, max_genes=50 }
    Output: ranked list of prognostic genes
    """
    data = request.get_json() or {}
    cancer_code = data.get("cancer_type", "").upper().strip()
    survival_type = data.get("survival_type", "OS").upper()
    cutoff = int(data.get("cutoff", 50))
    max_genes = int(data.get("max_genes", 50))
    
    if not cancer_code:
        return jsonify({"error": "cancer_type is required"}), 400
    
    study_id = CANCER_STUDIES.get(cancer_code)
    if not study_id:
        return jsonify({"error": f"Unknown cancer type: {cancer_code}"}), 400
    
    profile_id = get_molecular_profile_id(study_id)
    if not profile_id:
        return jsonify({"error": "No RNA-seq data available"}), 404
    
    # Get samples and clinical data (once)
    samples = get_samples(study_id)
    if not samples:
        return jsonify({"error": "No samples found"}), 404
    
    sample_ids = [s["sampleId"] for s in samples]
    sample_to_patient = {s["sampleId"]: s.get("patientId", s["sampleId"]) for s in samples}
    patients = get_clinical_data(study_id)
    clinical_df = parse_survival(patients, sample_to_patient)
    
    if len(clinical_df) < 20:
        return jsonify({"error": "Insufficient clinical data"}), 404
    
    # Screen genes
    results = []
    genes_to_test = GENE_LIST[:max_genes]
    
    for gene in genes_to_test:
        expr_data, gene_name = get_gene_expression(study_id, profile_id, gene)
        if not expr_data:
            continue
        
        result = compute_survival_analysis(expr_data, clinical_df, gene_name, survival_type, cutoff)
        if result and result["p_value"] < 0.05:
            results.append(result)
        
        # Rate limiting
        time.sleep(0.05)
    
    # Sort by p-value
    results.sort(key=lambda x: x["p_value"])
    
    # Add ranks
    for i, r in enumerate(results):
        r["rank"] = i + 1
    
    return jsonify({
        "cancer_type": cancer_code,
        "survival_type": survival_type,
        "cutoff": cutoff,
        "total_tested": len(genes_to_test),
        "significant_genes": len(results),
        "genes": results,
        "data_source": "cBioPortal/TCGA"
    })


# ============== Main ==============
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
