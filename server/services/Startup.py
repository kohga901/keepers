"""
Startup.py

Builds the FAISS index on server boot by fetching embeddings from Supabase.
Exposes `index`, `_item_ids`, `item_id_to_embedding`, `item_coordinates`, and
`EMBEDDING_DIM` for use by recommendation_service.py and clothes.py.

initialize() is called once, in a background thread, from main.py's startup event.
It used to run at import time, which blocked uvicorn from binding a port before
Render's port-scan timeout killed the deploy.

Memory matters here: the server runs on 512 MB. Nothing heavy (UMAP, torch) is
imported, and embeddings are fetched a page at a time so the whole catalog is
never held as parsed JSON at once.
"""

import csv
import json
import logging
import threading
from pathlib import Path

import faiss
import numpy as np

log = logging.getLogger(__name__)

# Length of a CLIP embedding.
EMBEDDING_DIM = 512

# Rows per request when fetching embeddings. Each row is ~12 KB of JSON.
EMBEDDING_PAGE_SIZE = 500

# 2D map position of each catalog item, the same file the app's map tab draws.
ITEM_COORDINATES_PATH = Path(__file__).resolve().parents[1] / "data" / "item_coordinates.csv"

# FAISS index over every item's embedding.
index = None

# item_id of each row in the index, in the same order.
_item_ids = None

# item_id → embedding lookup.
item_id_to_embedding = None

# item_id → (x, y) map position lookup.
item_coordinates = None

# Mean embedding of the catalog, subtracted from every embedding.
catalog_mean = None

# True once everything above is loaded and requests can be answered.
ready = False

# Guards mutation of index / _item_ids / item_id_to_embedding so a newly
# uploaded item (see routers/admin.py) can't race with a concurrent
# recommendations lookup that reads them mid-update.
_index_lock = threading.Lock()


def center_embeddings(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    CLIP embeddings of clothing photos all share one large common component
    (two random items have a cosine similarity of ~0.7), which drowns out the
    differences between items. Subtracting the catalog mean removes it.

    Args:
        raw: (N, 512) float32 array of raw embeddings. Normalized in place.

    Returns:
        (centered unit-length embeddings, the mean that was subtracted)
    """
    # Normalize so every embedding has magnitude 1.
    faiss.normalize_L2(raw)

    # Mean embedding of the whole catalog.
    mean = raw.mean(axis=0)

    # Subtract the mean from every embedding.
    centered = raw - mean

    # Normalize again so inner product is cosine similarity.
    faiss.normalize_L2(centered)
    return centered, mean


def _fetch_embeddings() -> tuple[list[int], np.ndarray]:
    """
    DB function. Fetches every item's embedding, one page at a time, converting
    each page to float32 straight away.
    """
    # Imported here so this module can be used without Supabase credentials
    # (see tools/simulate_recommendations.py).
    from db import supabase, supabase_fetch_all

    # item_ids and embeddings fetched so far, in the same order.
    item_ids: list[int] = []
    pages: list[np.ndarray] = []

    # SELECT item_id, embedding FROM "Embeddings" ORDER BY item_id
    query = lambda: supabase.table("Embeddings").select("item_id, embedding").order("item_id")

    # Fetch one page of rows at a time.
    for rows in supabase_fetch_all(query, page_size=EMBEDDING_PAGE_SIZE):
        # Skip empty pages.
        if not rows:
            continue

        # Add the item_ids of this page.
        item_ids.extend(int(row["item_id"]) for row in rows)

        # Add the embeddings of this page as a float32 array. An embedding may arrive as a JSON string.
        pages.append(np.array(
            [json.loads(row["embedding"]) if isinstance(row["embedding"], str) else row["embedding"] for row in rows],
            dtype=np.float32,
        ))
        log.info("Fetched %d embeddings so far", len(item_ids))

    # Without embeddings there is nothing to recommend.
    if not pages:
        raise RuntimeError("No embeddings found in Supabase. Server cannot start.")

    # Join the pages into one (N, 512) array.
    return item_ids, np.concatenate(pages)


def _load_item_coordinates() -> dict[int, tuple[float, float]]:
    """Loads item_id → (x, y) map positions. Missing file just disables user map positions."""
    # Without the file, return an empty lookup.
    if not ITEM_COORDINATES_PATH.exists():
        log.warning("%s not found, user map coordinates will not be updated", ITEM_COORDINATES_PATH)
        return {}

    # Read each row of the CSV into the lookup.
    with open(ITEM_COORDINATES_PATH, newline="", encoding="utf-8-sig") as f:
        return {int(row["item_id"]): (float(row["x"]), float(row["y"])) for row in csv.DictReader(f)}


def initialize():
    global index, _item_ids, item_id_to_embedding, item_coordinates, catalog_mean, ready

    try:
        # Fetch all embeddings from Supabase.
        log.info("Fetching embeddings from Supabase")
        item_ids_local, raw = _fetch_embeddings()

        # Center and normalize the embeddings.
        embeddings, mean = center_embeddings(raw)

        # Free the raw embeddings.
        del raw

        # Build index. Inner product on unit vectors is cosine similarity.
        idx = faiss.IndexFlatIP(EMBEDDING_DIM)
        idx.add(embeddings)

        # item_id → embedding lookup for building pref vecs
        mapping = {item_id: embeddings[i] for i, item_id in enumerate(item_ids_local)}

        # Load the map position of each item.
        coordinates = _load_item_coordinates()

        # Set the global variables, with ready last so nothing is read half-built.
        _item_ids = item_ids_local
        item_id_to_embedding = mapping
        item_coordinates = coordinates
        catalog_mean = mean
        index = idx
        ready = True
        log.info("Startup complete: index has %d items, %d have map coordinates", idx.ntotal, len(coordinates))
        log.info("=== SERVER READY: you can run expo now ===")
    except Exception:
        # This runs in a background thread, so without this the failure would be
        # silent and every request would return 503 forever.
        log.exception("Startup failed, server will keep answering 503")
        raise


def add_item_embedding(item_id: int, raw_embedding: np.ndarray) -> None:
    """
    Adds a freshly-uploaded item's embedding to the in-memory FAISS index so it
    is immediately eligible for recommendations, without waiting for a server
    restart. Mirrors the normalization and centering done in initialize().

    Args:
        item_id:       The item's id, already inserted into the Clothing/Embeddings tables.
        raw_embedding: The item's raw (un-normalized) 512-dim CLIP embedding.
    """
    if not ready:
        # Nothing to update yet — the next full initialize() will pick this
        # item up from Supabase anyway.
        return

    # FAISS requires a 2D array. Reshape the 1D embedding.
    vec = np.array(raw_embedding, dtype=np.float32).reshape(1, EMBEDDING_DIM)

    # Normalize, subtract the catalog mean, and normalize again.
    faiss.normalize_L2(vec)
    centered = vec - catalog_mean
    faiss.normalize_L2(centered)

    # Add the item to the index and both lookups.
    with _index_lock:
        index.add(centered)
        _item_ids.append(item_id)
        item_id_to_embedding[item_id] = centered[0]
