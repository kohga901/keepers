"""
recommendation_service.py

Gets the recommended K clothing items for a user.
    - Uses the built index and item_id's from Startup.py
"""

import faiss
import numpy as np

from services.Startup import index, _item_ids, EMBEDDING_DIM

def get_recommendations(
    pref_vec: np.ndarray,
    seen_item_ids: list[int],
    n: int = 20
) -> list[int]:
    """
    Returns n unseen item_ids ranked by cosine similarity to pref_vec.

    Args:
        pref_vec:       1D numpy array of shape (512,). The user's preference vector.
        seen_item_ids:  item_ids the user has already swiped on (liked or disliked).
        n:              number of recommendations to return.

    Returns:
        List of item_ids ranked by cosine similarity, with seen items removed.
    """

    # FAISS index.search() requires a 2D array. Currently the pref_vec is 1D. Reshape it.
    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)

    # Normalize it so the vector magnitude is 1.
    faiss.normalize_L2(pref)

    # Get number of clothes to search which is n + number of seen items. 
    k = min(n + len(seen_item_ids), index.ntotal)       # index.ntotal is number total items.

    # Getting unseen items with their respective faiss index.
    _, indices = index.search(pref, k=k)

    # Seen set of items.
    seen_set = set(seen_item_ids)

    # Filtering out the seen items from the fetched items.
    results = [
        _item_ids[idx]
        for idx in indices[0]
        if _item_ids[idx] not in seen_set
    ]

    return results[:n]

def get_recommendations_with_scores(
    pref_vec: np.ndarray,
    seen_item_ids: list[int],
    n: int = 20
) -> list[tuple[int, float]]:
    """
    This function is for debugging, the scores show how close the fetched items are to the pref_vec.
    """
    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)
    faiss.normalize_L2(pref)

    k = min(n + len(seen_item_ids), index.ntotal)
    scores, indices = index.search(pref, k=k)

    seen_set = set(seen_item_ids)
    results = [
        (_item_ids[idx], float(scores[0][i]))
        for i, idx in enumerate(indices[0])
        if _item_ids[idx] not in seen_set
    ]

    return results[:n]
    