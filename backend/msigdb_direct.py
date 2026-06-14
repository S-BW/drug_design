"""
MSigDB Direct Access Module
----------------------------
Fetch gene sets directly from MSigDB web API without gseapy dependency.
Uses MSigDB's GMT file format for fast gene set retrieval.

Categories supported:
  H: Hallmark (50 sets ~ 4000 genes)
  C2: Curated Pathways (KEGG, Reactome, BioCarta, etc.)
  C3: Regulatory Targets (TF, miRNA)
  C5: GO terms
  C6: Oncogenic Signatures (189 sets ~ 5000 genes)
  C7: Immunologic Signatures
  C8: Cell Type Signatures
"""

import requests
import urllib.request
import gzip
import os

# Cache directory
CACHE_DIR = os.path.join(os.path.dirname(__file__), "msigdb_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# MSigDB GMT file URLs
MSIGDB_URLS = {
    "H": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/h.all.v2023.2.Hs.symbols.gmt",
    "C2": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/c2.cp.v2023.2.Hs.symbols.gmt",
    "C3": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/c3.all.v2023.2.Hs.symbols.gmt",
    "C5": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/c5.go.bp.v2023.2.Hs.symbols.gmt",
    "C6": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/c6.all.v2023.2.Hs.symbols.gmt",
    "C7": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/c7.all.v2023.2.Hs.symbols.gmt",
    "C8": "https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2023.2.Hs/c8.all.v2023.2.Hs.symbols.gmt",
}

# Category info for display
CATEGORY_INFO = {
    "H": {"name": "Hallmark", "desc": "50个核心Hallmark基因集", "icon": "⭐"},
    "C2": {"name": "Curated Pathways", "desc": "KEGG/Reactome/BioCarta等通路基因集", "icon": "🔄"},
    "C3": {"name": "Regulatory Targets", "desc": "转录因子和miRNA靶基因集", "icon": "🎯"},
    "C5": {"name": "Gene Ontology", "desc": "GO生物学过程基因集", "icon": "🧬"},
    "C6": {"name": "Oncogenic Signatures", "desc": "189个癌症特征基因集", "icon": "🔬"},
    "C7": {"name": "Immunologic Signatures", "desc": "免疫系统特征基因集", "icon": "🛡️"},
    "C8": {"name": "Cell Type Signatures", "desc": "细胞类型特征基因集", "icon": "🔬"},
}

# In-memory cache
_GENE_SETS_CACHE = {}


def download_gmt(category):
    """Download GMT file for a category. Returns path to local file."""
    local_path = os.path.join(CACHE_DIR, f"{category}.gmt")
    if os.path.exists(local_path):
        return local_path
    
    url = MSIGDB_URLS.get(category)
    if not url:
        return None
    
    try:
        urllib.request.urlretrieve(url, local_path)
        return local_path
    except Exception:
        return None


def parse_gmt(file_path):
    """Parse GMT file. Returns dict {set_name: {genes: [...], desc: ...}}"""
    gene_sets = {}
    try:
        with open(file_path, 'r') as f:
            for line in f:
                parts = line.strip().split('\t')
                if len(parts) >= 3:
                    set_name = parts[0]
                    desc = parts[1]
                    genes = parts[2:]
                    gene_sets[set_name] = {
                        "genes": genes,
                        "description": desc,
                        "size": len(genes)
                    }
        return gene_sets
    except Exception:
        return {}


def get_gene_sets(category="C6"):
    """Get all gene sets from a category. Uses cache."""
    if category in _GENE_SETS_CACHE:
        return _GENE_SETS_CACHE[category]
    
    file_path = download_gmt(category)
    if not file_path:
        return {}
    
    gene_sets = parse_gmt(file_path)
    _GENE_SETS_CACHE[category] = gene_sets
    return gene_sets


def get_all_genes(category="C6"):
    """Get all unique genes from a category."""
    gene_sets = get_gene_sets(category)
    all_genes = set()
    for info in gene_sets.values():
        all_genes.update(info["genes"])
    return {
        "total": len(all_genes),
        "genes": sorted(list(all_genes)),
        "num_sets": len(gene_sets),
        "category": category,
        "category_name": CATEGORY_INFO.get(category, {}).get("name", category)
    }


def get_categories_info():
    """Return category metadata."""
    result = {}
    for code, info in CATEGORY_INFO.items():
        # Check if cached
        sets_data = get_gene_sets(code)
        if sets_data:
            all_genes = set()
            for s in sets_data.values():
                all_genes.update(s["genes"])
            result[code] = {
                **info,
                "sets_downloaded": len(sets_data),
                "genes_available": len(all_genes),
                "cached": True
            }
        else:
            result[code] = {
                **info,
                "sets_downloaded": 0,
                "genes_available": 0,
                "cached": False
            }
    return result


def get_genes_for_reverse(category="C6", max_sets=None, specific_sets=None):
    """
    Get gene list for reverse survival analysis.
    
    Args:
        category: MSigDB category code
        max_sets: Maximum number of gene sets to include (None = all)
        specific_sets: List of specific set names to use (None = all in category)
    
    Returns:
        dict with genes list and metadata
    """
    gene_sets = get_gene_sets(category)
    if not gene_sets:
        return {"error": f"Failed to load gene sets for category {category}"}
    
    all_genes = set()
    used_sets = []
    
    if specific_sets:
        # Use specific sets
        for set_name in specific_sets:
            if set_name in gene_sets:
                all_genes.update(gene_sets[set_name]["genes"])
                used_sets.append(set_name)
    else:
        # Use all or limited sets
        sets_to_use = list(gene_sets.items())
        if max_sets:
            sets_to_use = sets_to_use[:max_sets]
        for set_name, info in sets_to_use:
            all_genes.update(info["genes"])
            used_sets.append(set_name)
    
    return {
        "total_genes": len(all_genes),
        "genes": sorted(list(all_genes)),
        "category": category,
        "category_name": CATEGORY_INFO.get(category, {}).get("name", category),
        "num_sets_used": len(used_sets),
        "set_names": used_sets[:20],
        "source": "MSigDB 2023.2"
    }


def search_sets(keyword, category="C6"):
    """Search gene sets by keyword."""
    gene_sets = get_gene_sets(category)
    keyword_lower = keyword.lower()
    matches = []
    for name, info in gene_sets.items():
        if keyword_lower in name.lower() or keyword_lower in info.get("description", "").lower():
            matches.append({
                "name": name,
                "description": info.get("description", ""),
                "size": info["size"]
            })
    return matches[:30]


# Pre-computed cancer gene master list
# Combines C6 + selected C2 cancer pathways + H Hallmark cancer sets
CANCER_MASTER_GENE_SETS = [
    "C6",  # Oncogenic signatures
    "H",   # Hallmark
]


def get_master_cancer_gene_list():
    """Get comprehensive cancer gene list from multiple MSigDB categories."""
    all_genes = set()
    sources = []
    
    for cat in CANCER_MASTER_GENE_SETS:
        result = get_genes_for_reverse(category=cat)
        if "genes" in result:
            all_genes.update(result["genes"])
            sources.append(f"{cat}({result['num_sets_used']}sets:{len(result['genes'])}genes)")
    
    # Also add key cancer pathways from C2
    c2_sets = get_gene_sets("C2")
    cancer_c2_keywords = [
        "CANCER", "CARCINOMA", "TUMOR", "ONCOGENIC", "ONCO",
        "APOPTOSIS", "CELL_CYCLE", "DNA_REPAIR",
        "PI3K", "AKT", "MTOR", "MAPK", "ERK",
        "P53", "RB_", "MYC_", "WNT", "NOTCH",
        "TGF_BETA", "HYPOXIA", "ANGIOGENESIS",
        "RECEPTOR_TYROSINE_KINASE", "RTK",
        "JAK_STAT", "NF_KAPPA_B", "TNF",
        "IMMUNE", "CHECKPOINT", "PD_L1", "PD_1",
    ]
    
    c2_cancer_genes = set()
    c2_count = 0
    for set_name, info in c2_sets.items():
        if any(kw in set_name.upper() for kw in cancer_c2_keywords):
            c2_cancer_genes.update(info["genes"])
            c2_count += 1
    
    all_genes.update(c2_cancer_genes)
    sources.append(f"C2-cancer({c2_count}sets:{len(c2_cancer_genes)}genes)")
    
    return {
        "total_genes": len(all_genes),
        "genes": sorted(list(all_genes)),
        "sources": sources,
        "source": "MSigDB Multi-Category"
    }
