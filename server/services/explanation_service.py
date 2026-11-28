"""
explanation_service.py

Builds the short "Why am I seeing this?" reasons shown on some feed items.

Reasons are only ever built from what the recommender actually did, so they are
never made up:
    - exploit items (nearest to the user's taste) point at the liked item they are
      most similar to, or at tags the user likes often.
    - adjacent and random items say they are exploration.
    - cold start items say they are random while the app learns the user's taste.

Only a share of each batch gets a reason (see REASON_SHARE), chosen by a hash of the
user and item so the same card keeps or lacks its button if the feed is reloaded.
"""

from collections import Counter
from collections.abc import Callable
import hashlib

import numpy as np

from services import Startup
from services.recommendation_service import RECENCY_HALF_LIFE

# --- Tuning ---

# Share of the items in a batch that get a reason.
REASON_SHARE = 0.3

# How many of the most recent likes are searched for the closest liked item.
ANCHOR_LIKES = 200

# Lowest cosine similarity (of the centered embeddings) at which an item is said to
# be "because you liked" another. Below this the link would not be obvious to the user.
ANCHOR_MIN_SIMILARITY = 0.3

# A tag counts as one the user "often likes" when at least this many of their recent likes have it.
TAG_MIN_LIKES = 2

# Most tags named in one reason.
MAX_REASON_TAGS = 2


def _hash_fraction(user_id: str, item_id: int) -> float:
    """Stable number in [0, 1) for a user and item, the same on every server and restart."""
    digest = hashlib.sha256(f"{user_id}:{item_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def choose_explained(user_id: str, item_ids: list[int]) -> list[int]:
    """
    The items of a batch that get a reason: about REASON_SHARE of them, and at least one
    in a non-empty batch so every batch shows the feature.
    """
    chosen = [i for i in item_ids if _hash_fraction(user_id, i) < REASON_SHARE]
    if not chosen and item_ids:
        chosen = [min(item_ids, key=lambda i: _hash_fraction(user_id, i))]
    return chosen


def closest_liked(item_id: int, liked_ids: list[int]) -> tuple[int, float] | None:
    """
    The liked item most similar to item_id, and its similarity, searching the most recent
    ANCHOR_LIKES likes. Copies of the same product are skipped. None if nothing can be compared.
    """
    embeddings = Startup.item_id_to_embedding
    if item_id not in embeddings:
        return None

    # Copies of the item itself would make a pointless "because you liked this".
    copies = Startup.duplicates_of(item_id)
    candidates = [i for i in liked_ids[-ANCHOR_LIKES:] if i in embeddings and i not in copies]
    if not candidates:
        return None

    # Embeddings are unit length, so dot products are cosine similarities.
    similarities = np.stack([embeddings[i] for i in candidates]) @ embeddings[item_id]
    best = int(np.argmax(similarities))
    return candidates[best], float(similarities[best])


def liked_tag_counts(liked_ids: list[int]) -> Counter:
    """How many of the user's recent likes carry each tag."""
    counts: Counter = Counter()
    for liked_id in liked_ids[-RECENCY_HALF_LIFE:]:
        counts.update(Startup.item_tags.get(liked_id, ()))
    return counts


def shared_tags(item_id: int, tag_counts: Counter) -> list[str]:
    """The item's tags the user often likes, most liked first, at most MAX_REASON_TAGS."""
    tags = [t for t in Startup.item_tags.get(item_id, ()) if tag_counts[t] >= TAG_MIN_LIKES]
    tags.sort(key=lambda t: (-tag_counts[t], t))
    return tags[:MAX_REASON_TAGS]


def _join(words: list[str]) -> str:
    """["a"] → "a", ["a", "b"] → "a and b"."""
    return " and ".join(words) if len(words) <= 2 else ", ".join(words[:-1]) + " and " + words[-1]


def _reason(kind: str, text: str, **extra) -> dict:
    return {"kind": kind, "text": text, "liked_item_id": None, "liked_item_name": None,
            "liked_item_img": None, "tags": [], **extra}


def explain_batch(
    user_id: str,
    item_ids: list[int],
    sources: dict[int, str],
    liked_ids: list[int],
    categories: list[str],
    fetch_items: Callable[[list[int]], list[dict]],
) -> dict[int, dict]:
    """
    Reasons for a share of a batch (see choose_explained).

    Args:
        user_id:     the user the batch is for.
        item_ids:    the batch, in feed order. Items the user requested should be left out,
                     since they already have their own badge.
        sources:     item_id → "exploit", "adjacent" or "random", from get_recommendations().
                     Items not in here were picked on the cold start path.
        liked_ids:   the user's liked item_ids, oldest to newest.
        categories:  the active tag filter, empty for none.
        fetch_items: item_ids → Clothing rows, used to name the liked items reasons point at.

    Returns:
        item_id → {"kind", "text", "liked_item_id", "liked_item_name", "liked_item_img", "tags"}
        for the chosen items only.
    """
    chosen = choose_explained(user_id, item_ids)
    tag_counts = liked_tag_counts(liked_ids)

    # First pass: decide each reason. "Because you liked X" needs X's name, fetched afterwards
    # in one go, so those are held as the anchor's id for now.
    pending: dict[int, tuple[str, object]] = {}
    used_anchors: set[int] = set()
    for item_id in chosen:
        source = sources.get(item_id)

        if source is None:
            pending[item_id] = ("cold_start", None)
        elif source == "exploit":
            anchor = closest_liked(item_id, liked_ids)
            tags = shared_tags(item_id, tag_counts)

            # Name a liked item when the link is clear, but not the same one twice in a batch,
            # so the reasons in a batch vary.
            if anchor and anchor[1] >= ANCHOR_MIN_SIMILARITY and anchor[0] not in used_anchors:
                used_anchors.add(anchor[0])
                pending[item_id] = ("similar_to_like", anchor[0])
            elif tags:
                pending[item_id] = ("liked_tags", tags)
            else:
                pending[item_id] = ("close_to_taste", None)
        elif categories:
            # Exploration under a filter: the filter is the clearest thing to say.
            pending[item_id] = ("filter", None)
        elif source == "adjacent":
            pending[item_id] = ("adjacent", None)
        else:
            pending[item_id] = ("explore", None)

    # Name the liked items in one query.
    anchor_ids = [value for kind, value in pending.values() if kind == "similar_to_like"]
    anchors = {row["item_id"]: row for row in fetch_items(anchor_ids)} if anchor_ids else {}

    # Second pass: write the text.
    reasons: dict[int, dict] = {}
    for item_id, (kind, value) in pending.items():
        if kind == "similar_to_like":
            row = anchors.get(value)
            if row and row.get("item_name"):
                reasons[item_id] = _reason(kind, f"Because you liked {row['item_name']}",
                                           liked_item_id=value, liked_item_name=row["item_name"],
                                           liked_item_img=row.get("item_img"))
                continue
            # The liked item's row has gone missing, so fall back to the generic reason.
            kind = "close_to_taste"

        if kind == "liked_tags":
            reasons[item_id] = _reason(kind, f"You often like {_join([t.title() for t in value])} items", tags=value)
        elif kind == "close_to_taste":
            reasons[item_id] = _reason(kind, "Close to the style of the items you've liked")
        elif kind == "filter":
            reasons[item_id] = _reason(kind, f"Matches your filter: {_join([c.title() for c in categories])}",
                                       tags=list(categories))
        elif kind == "adjacent":
            reasons[item_id] = _reason(kind, "A little different from your usual style, to see if you like it")
        elif kind == "explore":
            reasons[item_id] = _reason(kind, "Something new, to help us learn your taste")
        elif kind == "cold_start":
            reasons[item_id] = _reason(kind, "Picked at random while we learn what you like")

    return reasons
