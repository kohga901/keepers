"""
recommendation_service.py

Gets the recommended K clothing items for a user.
    - Uses the built index and item_id's from Startup.py
"""

import faiss
import numpy as np

from services.Startup import index, _item_ids

EMBEDDING_DIM = 512

def get_recommendations(
    pref_vec: np.ndarray,
    seen_item_ids: list[str],
    n: int = 20
) -> list[str]:
    """
    Returns n unseen item_ids ranked by cosine similarity to pref_vec.

    Args:
        pref_vec:       1D numpy array of shape (512,). The user's preference vector.
        seen_item_ids:  item_ids the user has already swiped on (liked or disliked).
        n:              number of recommendations to return.

    Returns:
        List of item_ids ranked by cosine similarity, with seen items removed.
    """
    pass