"""
simulate_recommendations.py

Offline check of how well the recommendation algorithm follows a user's taste.
Runs entirely on files in this repo: no server and no Supabase needed.

Each simulated user likes every item carrying one of their tags and dislikes
everything else. They swipe through the feed the same way the app does (first
batch on load, next batch requested 3 cards before the deck runs out), and we
measure what share of the cards shown after the first 20 swipes they like.
A feed that ignores the user scores the "random" rate.

Usage (from the server/ folder):
    python tools/simulate_recommendations.py
"""

import collections
import csv
import json
import random
import sys
from pathlib import Path

import faiss
import numpy as np

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from services import Startup
from services import recommendation_service as rec

EMBEDDINGS_JSON = SERVER_DIR / "services" / "Embeddings" / "catalog_with_embeddings.json"
CLOTHING_CSV    = SERVER_DIR / "services" / "Embeddings" / "Clothing_rows.csv"
TAGS_CSV        = SERVER_DIR.parent / "Keepers" / "data" / "tag_csv" / "tagged_clothes.csv"

TASTES = [
    {"hoodie"},
    {"skirt"},
    {"blazer"},
    {"streetwear"},
    {"business"},
    {"hoodie", "skirt"},
    {"blazer", "leggings", "cardigan"},
]

USERS_PER_TASTE = 15
SWIPES = 60
WARMUP_SWIPES = 20
BATCH_SIZE = 10          # amountOfItemsToFetch in the app
FETCH_BEFORE_END = 3     # the app fetches when (index + 3) % BATCH_SIZE == 0


def load_catalog() -> dict[int, set[str]]:
    """Fills Startup's globals from local files and returns item_id → tags."""
    csv.field_size_limit(10**9)

    # The embeddings file has no item_id, so match rows to ids by image link.
    with open(CLOTHING_CSV, encoding="utf-8", errors="replace") as f:
        img_to_id = {row["item_img"]: int(row["item_id"]) for row in csv.DictReader(f)}

    tags: dict[int, set[str]] = collections.defaultdict(set)
    with open(TAGS_CSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            tags[int(row["clothes_id"])].add(row["Tag"])

    with open(EMBEDDINGS_JSON, encoding="utf-8") as f:
        catalog = json.load(f)

    item_ids, vectors = [], []
    for row in catalog:
        item_id = img_to_id.get(row["item_img"])
        if item_id in tags:
            item_ids.append(item_id)
            vectors.append(row["embedding"])

    embeddings, mean = Startup.center_embeddings(np.array(vectors, dtype=np.float32))

    index = faiss.IndexFlatIP(Startup.EMBEDDING_DIM)
    index.add(embeddings)

    Startup.index = index
    Startup._item_ids = item_ids
    Startup.item_id_to_embedding = {item_id: embeddings[i] for i, item_id in enumerate(item_ids)}
    Startup.catalog_mean = mean
    Startup.item_coordinates = {}
    Startup.ready = True

    return tags


def next_batch(liked: list[int], disliked: list[int], excluded: set[int]) -> list[int]:
    """Same decision the /clothes/recommendations endpoint makes."""
    pref_vec = rec.compute_pref_vec(liked, disliked)

    if not np.any(pref_vec):
        unseen = [i for i in Startup._item_ids if i not in excluded]
        return random.sample(unseen, k=min(BATCH_SIZE, len(unseen)))

    return rec.get_recommendations(pref_vec, excluded, n=BATCH_SIZE * 5, batch_size=BATCH_SIZE)[:BATCH_SIZE]


def simulate_user(taste: set[str], tags: dict[int, set[str]]) -> float:
    """Returns the share of cards after the warmup that the user liked."""
    liked: list[int] = []
    disliked: list[int] = []
    deck = next_batch(liked, disliked, set())
    outcomes: list[bool] = []

    for position in range(SWIPES):
        if position >= len(deck):
            break

        item_id = deck[position]
        likes_it = bool(tags[item_id] & taste)
        outcomes.append(likes_it)
        (liked if likes_it else disliked).append(item_id)

        if (position + FETCH_BEFORE_END) % BATCH_SIZE == 0:
            deck += next_batch(liked, disliked, set(deck))

    return float(np.mean(outcomes[WARMUP_SWIPES:]))


def main():
    tags = load_catalog()
    print(f"Catalog: {len(Startup._item_ids)} items with tags and embeddings")
    print(f"Like rate on cards {WARMUP_SWIPES + 1}-{SWIPES}, average of {USERS_PER_TASTE} simulated users per taste\n")
    print(f"{'taste':<28}{'random':>8}{'feed':>8}")

    rates = []
    for taste in TASTES:
        random.seed(1)
        np.random.seed(1)

        base_rate = np.mean([bool(tags[i] & taste) for i in Startup._item_ids])
        rate = np.mean([simulate_user(taste, tags) for _ in range(USERS_PER_TASTE)])
        rates.append(rate)

        print(f"{'+'.join(sorted(taste)):<28}{base_rate:>8.0%}{rate:>8.0%}")

    print(f"\n{'mean':<28}{'':>8}{np.mean(rates):>8.0%}")


if __name__ == "__main__":
    main()
