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

# --- Preference tuning ---

# How strongly the average disliked item pushes the pref_vec away, relative to
# the average liked item pulling it in.
DISLIKE_WEIGHT = 0.35

# Recency: a swipe's weight halves every this many newer swipes of the same kind,
# so the 30th most recent like counts half as much as the latest one.
RECENCY_HALF_LIFE = 30

# How many of the nearest catalog items are averaged to place a user on the map.
COORDINATE_NEIGHBOURS = 15

# --- Diversity tuning ---
# Tune these with tools/simulate_recommendations.py.

# MMR trade-off: 1.0 = pure similarity (old behaviour), lower = more diverse.
MMR_LAMBDA = 0.7

# How many nearest unseen items MMR is allowed to choose from.
MMR_POOL_SIZE = 50

# "Adjacent" items are sampled from similarity ranks [MMR_POOL_SIZE, ADJACENT_POOL_SIZE).
ADJACENT_POOL_SIZE = 500

# Fraction of each batch reserved for exploration. The rest is exploit (MMR).
ADJACENT_FRAC = 0.1
RANDOM_FRAC = 0.1


def _recency_weighted_mean(item_ids: list[int]) -> np.ndarray | None:
    """
    Recency-weighted mean embedding of the given items, ordered oldest to newest.
    The newest item has weight 1, and weights halve every RECENCY_HALF_LIFE items back.

    Returns:
        The weighted mean, or None if none of the items have an embedding.
    """
    # item_id → embedding lookup built at startup.
    embeddings = Startup.item_id_to_embedding

    # Position of the newest item in the list.
    newest = len(item_ids) - 1

    # Collect each item's embedding and its weight.
    vecs, weights = [], []
    for position, item_id in enumerate(item_ids):
        # Skip items that have no embedding.
        if item_id in embeddings:
            vecs.append(embeddings[item_id])

            # The further back the item is, the smaller its weight.
            weights.append(0.5 ** ((newest - position) / RECENCY_HALF_LIFE))

    # None of the items had an embedding.
    if not vecs:
        return None

    # Weighted average of the embeddings.
    return np.average(vecs, axis=0, weights=weights)


def compute_pref_vec(liked_ids: list[int], disliked_ids: list[int]) -> np.ndarray:
    """
    Builds a preference vector from a user's full swipe history:
        normalize(wmean(liked) - DISLIKE_WEIGHT * wmean(disliked))

    wmean is a recency-weighted mean, so recent swipes count more (see
    RECENCY_HALF_LIFE). The result only depends on the two lists, so repeated
    swipes and unlikes can't make it drift.

    Args:
        liked_ids:    Liked item_ids, ordered oldest to newest.
        disliked_ids: Disliked item_ids, ordered oldest to newest.

    Returns:
        Unit-length preference vector, or an all 0 vector if the user has no likes.
    """
    # Average embedding of the liked items.
    liked_mean = _recency_weighted_mean(liked_ids)

    # With no likes there is nothing to point towards. The opposite of a disliked
    # item isn't a meaningful direction, so stay on the cold start path.
    if liked_mean is None:
        return np.zeros(EMBEDDING_DIM, dtype=np.float32)

    # Start from what the user likes.
    pref_vec = liked_mean

    # Push away from the average embedding of the disliked items.
    disliked_mean = _recency_weighted_mean(disliked_ids)
    if disliked_mean is not None:
        pref_vec = pref_vec - DISLIKE_WEIGHT * disliked_mean

    # Normalize so the vector magnitude is 1.
    norm = np.linalg.norm(pref_vec)
    if norm > 0:
        pref_vec = pref_vec / norm

    # Return the preference vector.
    return pref_vec.astype(np.float32)


def estimate_coordinates(pref_vec: np.ndarray) -> tuple[float, float] | None:
    """
    Places a preference vector on the 2D item map: the similarity-weighted
    average position of the catalog items nearest to it. This stands in for
    UMAP's transform(), which costs ~250 MB of memory just to import.

    Returns:
        (x, y), or None if no nearby item has a map position.
    """
    # FAISS index.search() requires a 2D array. Reshape the 1D pref_vec.
    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)

    # item_id → (x, y) lookup loaded at startup.
    coordinates = Startup.item_coordinates

    # Hold the lock so an admin upload can't change the index mid-search.
    with Startup._index_lock:
        # Not every item has a map position, so look a bit further than needed.
        k = min(COORDINATE_NEIGHBOURS * 4, Startup.index.ntotal)

        # Get the k nearest items and their similarity scores.
        scores, indices = Startup.index.search(pref, k=k)

        # Pair each nearest item's item_id with its score.
        neighbours = [(Startup._item_ids[idx], float(score)) for idx, score in zip(indices[0], scores[0])]

    # Keep only items that have a map position and a positive similarity.
    points = [(coordinates[item_id], score) for item_id, score in neighbours if item_id in coordinates and score > 0]

    # Keep the nearest COORDINATE_NEIGHBOURS of them.
    points = points[:COORDINATE_NEIGHBOURS]

    # No nearby item has a map position.
    if not points:
        return None

    # Positions of the items, and their similarity scores as weights.
    xy = np.array([p for p, _ in points])
    weights = np.array([w for _, w in points])

    # Weighted average position.
    x, y = (xy * weights[:, None]).sum(axis=0) / weights.sum()
    return float(x), float(y)


def _mmr_select(cand_vecs: np.ndarray, pref: np.ndarray, count: int, lam: float) -> list[int]:
    """
    Maximal Marginal Relevance. Greedily picks `count` rows of cand_vecs, each maximising
        lam * sim(item, pref) - (1 - lam) * max sim(item, already picked).

    Returns row positions into cand_vecs, in pick order. Vectors must be L2-normalized.
    """
    # Can't pick more items than there are candidates.
    count = min(count, len(cand_vecs))
    if count <= 0:
        return []

    # Similarity of each candidate to the pref_vec.
    relevance = cand_vecs @ pref

    # Highest similarity of each candidate to anything picked so far.
    max_sim_to_picked = np.zeros(len(cand_vecs), dtype=np.float32)

    # Candidates that haven't been picked yet.
    available = np.ones(len(cand_vecs), dtype=bool)

    # Row positions of the picked candidates, in pick order.
    picked: list[int] = []

    for step in range(count):
        # With nothing picked yet there is no redundancy term, so the first pick is the nearest item.
        penalty = (1.0 - lam) * max_sim_to_picked if step > 0 else 0.0

        # Score every candidate. Already picked ones get -inf so they can't win.
        scores = np.where(available, lam * relevance - penalty, -np.inf)

        # Pick the best scoring candidate.
        j = int(np.argmax(scores))
        picked.append(j)
        available[j] = False

        # Update how similar each candidate is to the picked set.
        max_sim_to_picked = np.maximum(max_sim_to_picked, cand_vecs @ cand_vecs[j])

    return picked


def get_recommendations(
    pref_vec: np.ndarray,
    seen_item_ids: list[int],
    n: int = 20,
    batch_size: int | None = None,
    allowed_ids: set[int] | None = None,
) -> list[int]:
    """
    Returns n unseen item_ids mixing three kinds of items:
        - exploit:  nearest to pref_vec, re-ranked with MMR so they aren't near-duplicates.
        - adjacent: random picks from further down the similarity ranking.
        - random:   random picks from the whole unseen catalog.

    All three pools only contain allowed items, so a tag filter doesn't remove the
    exploration slots.

    Each consecutive `batch_size` items contain the exploit/adjacent/random mix (shuffled),
    so a caller that only uses the first batch_size items still gets the mix.

    Args:
        pref_vec:       1D numpy array of shape (512,). The user's preference vector.
        seen_item_ids:  item_ids the user has already swiped on (liked or disliked).
        n:              number of recommendations to return.
        batch_size:     size of one client-facing batch. Defaults to n.
        allowed_ids:    if given, only these item_ids may be returned (a tag filter).

    Returns:
        List of item_ids, seen items removed.
    """
    # Default to one batch covering all n items.
    batch_size = batch_size or n

    # FAISS index.search() requires a 2D array. Reshape the 1D pref_vec.
    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)

    # Normalize it so the vector magnitude is 1.
    faiss.normalize_L2(pref)

    # Seen set of items.
    seen_set = set(seen_item_ids)

    # Snapshot under the lock so an admin upload can't resize things mid-read.
    with Startup._index_lock:
        # Search far enough to still have ADJACENT_POOL_SIZE items after removing seen ones.
        # With a filter most of the nearest items may be dropped, so rank the whole catalog.
        # The index is a flat scan anyway, so this costs little extra.
        k = Startup.index.ntotal if allowed_ids is not None else min(ADJACENT_POOL_SIZE + len(seen_set), Startup.index.ntotal)

        # Get the k nearest items by cosine similarity.
        _, indices = Startup.index.search(pref, k=k)
        item_ids = Startup._item_ids

        # Unseen allowed items, nearest first.
        def eligible(item_id: int) -> bool:
            return item_id not in seen_set and (allowed_ids is None or item_id in allowed_ids)

        ranked = [item_ids[idx] for idx in indices[0] if eligible(item_ids[idx])]

        # Every unseen allowed item in the catalog.
        all_unseen = [i for i in item_ids if eligible(i)]
        embeddings = Startup.item_id_to_embedding

        # The nearest unseen items, and their embeddings, for MMR to choose from.
        pool = ranked[:MMR_POOL_SIZE]
        cand_vecs = np.stack([embeddings[i] for i in pool]) if pool else np.empty((0, EMBEDDING_DIM), dtype=np.float32)

    # Exploit pool: MMR over the nearest unseen items, in pick order.
    exploit_pool = [pool[j] for j in _mmr_select(cand_vecs, pref[0], n, MMR_LAMBDA)]
    exploit_set = set(exploit_pool)

    # Adjacent pool: further down the ranking, shuffled.
    adjacent_pool = ranked[MMR_POOL_SIZE:ADJACENT_POOL_SIZE]
    random.shuffle(adjacent_pool)

    # Random pool: anything unseen, shuffled.
    random_pool = [i for i in all_unseen if i not in exploit_set]
    random.shuffle(random_pool)

    # Items already added to the results, and the results in order.
    used: set[int] = set()
    results: list[int] = []

    def take(source: list[int]) -> bool:
        # Pop items off the pool until one is found that isn't in the results yet.
        while source:
            item = source.pop()
            if item not in used:
                # Mark the item and its copies as used, so the same product isn't added twice.
                used.update(Startup.duplicates_of(item))
                results.append(item)
                return True

        # The pool is empty.
        return False

    # Exploit pool is consumed best-first, so reverse it for pop().
    exploit_pool.reverse()
    pools = {"exploit": exploit_pool, "adjacent": adjacent_pool, "random": random_pool}

    # Fill the results one batch at a time.
    while len(results) < n:
        # Size of this batch. The last one may be smaller.
        size = min(batch_size, n - len(results))

        # How many adjacent and random items this batch gets.
        n_adj = round(size * ADJACENT_FRAC)
        n_rand = round(size * RANDOM_FRAC)

        # One slot per item in the batch, shuffled so the kinds are mixed.
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
    # FAISS index.search() requires a 2D array. Reshape the 1D pref_vec.
    pref = np.array(pref_vec, dtype=np.float32).reshape(1, EMBEDDING_DIM)

    # Normalize it so the vector magnitude is 1.
    faiss.normalize_L2(pref)

    # Seen set of items.
    seen_set = set(seen_item_ids)

    # Hold the lock so an admin upload can't change the index mid-search.
    with Startup._index_lock:
        # Number of items to search, which is n + number of seen items.
        k = min(n + len(seen_set), Startup.index.ntotal)

        # Get the k nearest items and their similarity scores.
        scores, indices = Startup.index.search(pref, k=k)

        # Filter out the seen items, keeping each item's score.
        results = [
            (Startup._item_ids[idx], float(scores[0][i]))
            for i, idx in enumerate(indices[0])
            if Startup._item_ids[idx] not in seen_set
        ]

    return results[:n]
