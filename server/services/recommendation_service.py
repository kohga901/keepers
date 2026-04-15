"""
recommendation_service.py

Gets the recommended K clothing items for a user.
"""

import faiss
import numpy as np
from pathlib import Path

def get_recommendations(
    pref_vec: np.ndarray,
    seen_item_ids: list[str],
    n: int = 20
) -> list[str]:
    """
    Returns n unseen item_ids ranked by cosine similarity to pref_vec.
    pref_vec: 1D numpy array of shape (512,)
    seen_item_ids: list of item_ids the user has already swiped on
    """
    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)
    faiss.normalize_L2(pref)

    k = min(n + len(seen_item_ids), index.ntotal)
    _, indices = index.search(pref, k=k)

    seen_set = set(seen_item_ids)
    results = [
        _item_ids[idx]
        for idx in indices[0]
        if _item_ids[idx] not in seen_set
    ]

    return results[:n]