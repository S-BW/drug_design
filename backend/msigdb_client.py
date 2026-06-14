"""
MSigDB Client Module
--------------------
Integration with Molecular Signatures Database (MSigDB) for
gene set enrichment and cancer gene screening.

Categories:
  H: Hallmark gene sets (50 sets)
  C1: Positional gene sets
  C2: Curated gene sets (KEGG, Reactome, BioCarta, etc.)
  C3: Regulatory target genes (TF, miRNA)
  C4: Computational gene sets
  C5: GO gene sets
  C6: Oncogenic signature gene sets (189 sets) -- most relevant
  C7: Immunologic signature gene sets
  C8: Cell type signature gene sets
"""

import gseapy as gp
import requests
import json

# Cache for gene sets
_GENE_SET_CACHE = {}

# MSigDB category display info
MSIGDB_CATEGORIES = {
    "H": {
        "name": "Hallmark",
        "description": "50个Hallmark基因集，代表明确生物学状态或过程",
        "sets_count": 50,
        "icon": "⭐"
    },
    "C2": {
        "name": "Curated Pathways",
        "description": "通路数据库基因集(KEGG/Reactome/BioCarta等)",
        "sets_count": 6000,
        "icon": "🔄"
    },
    "C3": {
        "name": "Regulatory Targets",
        "description": "转录因子和miRNA靶基因集",
        "sets_count": 3700,
        "icon": "🎯"
    },
    "C5": {
        "name": "Gene Ontology",
        "description": "GO生物学过程/分子功能/细胞组分基因集",
        "sets_count": 10000,
        "icon": "🧬"
    },
    "C6": {
        "name": "Oncogenic Signatures",
        "description": "癌症特征基因集(癌基因/肿瘤抑制/治疗响应等)",
        "sets_count": 189,
        "icon": "🔬"
    },
    "C7": {
        "name": "Immunologic Signatures",
        "description": "免疫系统特征基因集",
        "sets_count": 5200,
        "icon": "🛡️"
    },
    "C8": {
        "name": "Cell Type Signatures",
        "description": "单细胞水平细胞类型特征基因集",
        "sets_count": 8300,
        "icon": "🔬"
    },
}

# Pre-selected high-value cancer gene sets for reverse analysis
DEFAULT_CANCER_GENE_SETS = [
    "KEGG_PATHWAYS_IN_CANCER",
    "REACTOME_SIGNALING_BY_RECEPTOR_TYROSINE_KINASES",
    "REACTOME_DNA_REPAIR",
    "REACTOME_CELL_CYCLE",
    "REACTOME_APOPTOSIS",
    "REACTOME_PI3K_AKT_SIGNALING",
    "REACTOME_MAPK_SIGNALING",
    "REACTOME_WNT_SIGNALING",
    "REACTOME_NOTCH_SIGNALING",
    "REACTOME_TGF_BETA_SIGNALING",
    "REACTOME_P53_DEPENDENT_G1_DNA_DAMAGE_RESPONSE",
    "HALLMARK_APOPTOSIS",
    "HALLMARK_DNA_REPAIR",
    "HALLMARK_E2F_TARGETS",
    "HALLMARK_G2M_CHECKPOINT",
    "HALLMARK_HYPOXIA",
    "HALLMARK_EPITHELIAL_MESENCHYMAL_TRANSITION",
    "HALLMARK_ANGIOGENESIS",
    "HALLMARK_INFLAMMATORY_RESPONSE",
    "HALLMARK_IL6_JAK_STAT3_SIGNALING",
    "HALLMARK_KRAS_SIGNALING_UP",
    "HALLMARK_KRAS_SIGNALING_DN",
    "HALLMARK_PI3K_AKT_MTOR_SIGNALING",
    "HALLMARK_TNFA_SIGNALING_VIA_NFKB",
    "HALLMARK_P53_PATHWAY",
    "HALLMARK_MYC_TARGETS_V1",
    "HALLMARK_MYC_TARGETS_V2",
    "HALLMARK_OXIDATIVE_PHOSPHORYLATION",
    "HALLMARK_GLYCOLYSIS",
    "HALLMARK_UV_RESPONSE_UP",
    "HALLMARK_UV_RESPONSE_DN",
    "HALLMARK_ANDROGEN_RESPONSE",
    "HALLMARK_ESTROGEN_RESPONSE_EARLY",
    "HALLMARK_ESTROGEN_RESPONSE_LATE",
    "HALLMARK_HEME_METABOLISM",
    "BIOCARTA_P53_PATHWAY",
    "BIOCARTA_RB_PATHWAY",
    "BIOCARTA_NFKB_PATHWAY",
    "BIOCARTA_VEGF_PATHWAY",
    "PID_AKT_PATHWAY",
    "PID_HIF1A_PATHWAY",
    "PID_MTOR_4PATHWAY",
    "PID_ERBB_NETWORK_PATHWAY",
    "PID_FGF_PATHWAY",
    "NABA_CORE_MATRISOME",
    "NABA_ECM_AFFILIATED",
    "REACTOME_CELLULAR_SENESCENCE",
    "REACTOME_TELOMERE_MAINTENANCE",
    "REACTOME_CHROMATIN_MODIFYING_ENZYMES",
    "REACTOME_RNA_POLYMERASE_II_TRANSCRIPTION",
    "REACTOME_IMMUNE_SYSTEM",
]


def get_msigdb_categories():
    """Return available MSigDB categories."""
    return MSIGDB_CATEGORIES


def get_gene_set_names(category="C6", organism="human"):
    """Get list of gene set names from a MSigDB category."""
    try:
        lib_list = gp.get_library_list(organism=organism)
        # Filter for requested category
        category_prefix = category if category != "H" else "hallmark"
        names = [n for n in lib_list if category_prefix.lower() in n.lower()]
        return names[:200]  # Limit to first 200
    except Exception as e:
        return {"error": str(e)}


def get_gene_set(gene_set_name, organism="human"):
    """
    Fetch a specific gene set from MSigDB.
    Returns: dict {set_name: [gene1, gene2, ...]}
    """
    cache_key = f"{gene_set_name}_{organism}"
    if cache_key in _GENE_SET_CACHE:
        return _GENE_SET_CACHE[cache_key]
    
    try:
        # Use gseapy to get the gene set
        geneset = gp.get_library(name=gene_set_name, organism=organism)
        _GENE_SET_CACHE[cache_key] = geneset
        return geneset
    except Exception as e:
        return {"error": str(e), "gene_set_name": gene_set_name}


def get_all_genes_from_sets(gene_set_names, organism="human"):
    """
    Get all unique genes from multiple gene sets.
    Returns: list of unique gene symbols
    """
    all_genes = set()
    errors = []
    
    for gs_name in gene_set_names:
        gs = get_gene_set(gs_name, organism)
        if isinstance(gs, dict) and "error" in gs:
            errors.append(f"{gs_name}: {gs['error']}")
            continue
        # geneset is a dict {set_name: [genes]}
        if isinstance(gs, dict):
            for set_name, genes in gs.items():
                if isinstance(genes, (list, tuple)):
                    all_genes.update(genes)
        
    return {
        "total_genes": len(all_genes),
        "genes": sorted(list(all_genes)),
        "errors": errors,
        "source": "MSigDB"
    }


def get_default_cancer_genes():
    """
    Get the default curated cancer gene list from MSigDB.
    Combines multiple cancer-relevant gene sets.
    """
    result = get_all_genes_from_sets(DEFAULT_CANCER_GENE_SETS)
    return result


def get_genes_by_category(category="C6", max_sets=50, organism="human"):
    """
    Get all genes from a specific MSigDB category.
    
    Args:
        category: MSigDB category code (H, C2, C3, C5, C6, C7, C8)
        max_sets: Maximum number of gene sets to include
        organism: 'human' or 'mouse'
    
    Returns:
        dict with total_genes, genes, source_sets
    """
    set_names = get_gene_set_names(category, organism)
    if isinstance(set_names, dict) and "error" in set_names:
        return set_names
    
    selected_sets = set_names[:max_sets]
    result = get_all_genes_from_sets(selected_sets, organism)
    result["category"] = category
    result["category_name"] = MSIGDB_CATEGORIES.get(category, {}).get("name", category)
    result["num_sets"] = len(selected_sets)
    result["set_names"] = selected_sets[:20]  # Show first 20
    return result


def search_gene_sets(keyword, organism="human"):
    """Search MSigDB gene sets by keyword."""
    try:
        all_sets = gp.get_library_list(organism=organism)
        keyword_lower = keyword.lower()
        matches = [s for s in all_sets if keyword_lower in s.lower()]
        return {
            "keyword": keyword,
            "matches": matches[:50],
            "count": len(matches),
            "source": "MSigDB"
        }
    except Exception as e:
        return {"error": str(e)}


def get_genes_for_reverse_analysis(gene_set_name=None, category="C6", max_sets=30, organism="human"):
    """
    Get gene list for reverse survival analysis.
    
    Strategy:
    1. If gene_set_name provided, use that specific set
    2. If category provided, combine all sets from that category
    3. Default: use C6 (Oncogenic Signatures) + curated cancer sets
    """
    if gene_set_name:
        gs = get_gene_set(gene_set_name, organism)
        if isinstance(gs, dict) and "error" not in gs:
            all_genes = set()
            for genes in gs.values():
                if isinstance(genes, (list, tuple)):
                    all_genes.update(genes)
            return {
                "total_genes": len(all_genes),
                "genes": sorted(list(all_genes)),
                "source": f"MSigDB:{gene_set_name}",
                "category": "custom"
            }
    
    # Default: get genes from category
    result = get_genes_by_category(category, max_sets, organism)
    return result
