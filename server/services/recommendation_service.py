"""
recommendation_service.py

Gets the recommended K clothing items for a user.
    - Uses the built index and item_id's from Startup.py
"""

import random

import faiss
import numpy as np

from services.Startup import EMBEDDING_DIM
from services import Startup

# --- Diversity tuning ---

# MMR trade-off: 1.0 = pure similarity (old behaviour), lower = more diverse.
MMR_LAMBDA = 0.7

# How many nearest unseen items MMR is allowed to choose from.
MMR_POOL_SIZE = 100

# "Adjacent" items are sampled from similarity ranks [MMR_POOL_SIZE, ADJACENT_POOL_SIZE).
ADJACENT_POOL_SIZE = 500

# Fraction of each batch reserved for exploration. The rest is exploit (MMR).
ADJACENT_FRAC = 0.2
RANDOM_FRAC = 0.2


def _mmr_select(cand_vecs: np.ndarray, pref: np.ndarray, count: int, lam: float) -> list[int]:
    """
    Maximal Marginal Relevance. Greedily picks `count` rows of cand_vecs, each maximising
        lam * sim(item, pref) - (1 - lam) * max sim(item, already picked).

    Returns row positions into cand_vecs, in pick order. Vectors must be L2-normalized.
    """
    count = min(count, len(cand_vecs))
    if count <= 0:
        return []

    relevance = cand_vecs @ pref
    max_sim_to_picked = np.zeros(len(cand_vecs), dtype=np.float32)
    available = np.ones(len(cand_vecs), dtype=bool)
    picked: list[int] = []

    for step in range(count):
        # With nothing picked yet there is no redundancy term, so the first pick is the nearest item.
        penalty = (1.0 - lam) * max_sim_to_picked if step > 0 else 0.0
        scores = np.where(available, lam * relevance - penalty, -np.inf)
        j = int(np.argmax(scores))
        picked.append(j)
        available[j] = False
        max_sim_to_picked = np.maximum(max_sim_to_picked, cand_vecs @ cand_vecs[j])

    return picked


def get_recommendations(
    pref_vec: np.ndarray,
    seen_item_ids: list[int],
    n: int = 20,
    batch_size: int | None = None,
) -> list[int]:
    """
    Returns n unseen item_ids mixing three kinds of items:
        - exploit:  nearest to pref_vec, re-ranked with MMR so they aren't near-duplicates.
        - adjacent: random picks from further down the similarity ranking.
        - random:   random picks from the whole unseen catalog.

    Each consecutive `batch_size` items contain the exploit/adjacent/random mix (shuffled),
    so a caller that only uses the first batch_size items still gets the mix.

    Args:
        pref_vec:       1D numpy array of shape (512,). The user's preference vector.
        seen_item_ids:  item_ids the user has already swiped on (liked or disliked).
        n:              number of recommendations to return.
        batch_size:     size of one client-facing batch. Defaults to n.

    Returns:
        List of item_ids, seen items removed.
    """
    batch_size = batch_size or n

    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)
    faiss.normalize_L2(pref)

    seen_set = set(seen_item_ids)

    # Snapshot under the lock so an admin upload can't resize things mid-read.
    with Startup._index_lock:
        k = min(ADJACENT_POOL_SIZE + len(seen_set), Startup.index.ntotal)
        _, indices = Startup.index.search(pref, k=k)
        item_ids = Startup._item_ids
        ranked = [item_ids[idx] for idx in indices[0] if item_ids[idx] not in seen_set]
        all_unseen = [i for i in item_ids if i not in seen_set]
        embeddings = Startup.item_id_to_embedding

        pool = ranked[:MMR_POOL_SIZE]
        cand_vecs = np.stack([embeddings[i] for i in pool]) if pool else np.empty((0, EMBEDDING_DIM), dtype=np.float32)

    # Exploit pool: MMR over the nearest unseen items, in pick order.
    exploit_pool = [pool[j] for j in _mmr_select(cand_vecs, pref[0], n, MMR_LAMBDA)]
    exploit_set = set(exploit_pool)

    # Adjacent pool: further down the ranking, shuffled.
    adjacent_pool = ranked[MMR_POOL_SIZE:]
    random.shuffle(adjacent_pool)

    # Random pool: anything unseen, shuffled.
    random_pool = [i for i in all_unseen if i not in exploit_set]
    random.shuffle(random_pool)

    used: set[int] = set()
    results: list[int] = []

    def take(source: list[int]) -> bool:
        while source:
            item = source.pop()
            if item not in used:
                used.add(item)
                results.append(item)
                return True
        return False

    # Exploit pool is consumed best-first, so reverse it for pop().
    exploit_pool.reverse()
    pools = {"exploit": exploit_pool, "adjacent": adjacent_pool, "random": random_pool}

    while len(results) < n:
        size = min(batch_size, n - len(results))
        n_adj = round(size * ADJACENT_FRAC)
        n_rand = round(size * RANDOM_FRAC)
        slots = ["adjacent"] * n_adj + ["random"] * n_rand + ["exploit"] * (size - n_adj - n_rand)
        random.shuffle(slots)

        before = len(results)
        for slot in slots:
            # If a pool runs dry, fall back to the others so the batch is still filled.
            for name in (slot, "exploit", "adjacent", "random"):
                if take(pools[name]):
                    break
        if len(results) == before:
            break   # Nothing left to recommend.

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

    k = min(n + len(seen_item_ids), Startup.index.ntotal)
    scores, indices = Startup.index.search(pref, k=k)

    seen_set = set(seen_item_ids)
    results = [
        (Startup._item_ids[idx], float(scores[0][i]))
        for i, idx in enumerate(indices[0])
        if Startup._item_ids[idx] not in seen_set
    ]

    return results[:n]