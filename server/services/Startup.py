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

EMBEDDING_DIM = 512

# Rows per request when fetching embeddings. Each row is ~12 KB of JSON.
EMBEDDING_PAGE_SIZE = 500

# 2D map position of each catalog item, the same file the app's map tab draws.
ITEM_COORDINATES_PATH = Path(__file__).resolve().parents[1] / "data" / "item_coordinates.csv"

index = None
_item_ids = None
item_id_to_embedding = None
item_coordinates = None
catalog_mean = None
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
    faiss.normalize_L2(raw)
    mean = raw.mean(axis=0)
    centered = raw - mean
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

    item_ids: list[int] = []
    pages: list[np.ndarray] = []

    query = lambda: supabase.table("Embeddings").select("item_id, embedding").order("item_id")

    for rows in supabase_fetch_all(query, page_size=EMBEDDING_PAGE_SIZE):
        if not rows:
            continue
        item_ids.extend(int(row["item_id"]) for row in rows)
        pages.append(np.array(
            [json.loads(row["embedding"]) if isinstance(row["embedding"], str) else row["embedding"] for row in rows],
            dtype=np.float32,
        ))
        log.info("Fetched %d embeddings so far", len(item_ids))

    if not pages:
        raise RuntimeError("No embeddings found in Supabase. Server cannot start.")

    return item_ids, np.concatenate(pages)


def _load_item_coordinates() -> dict[int, tuple[float, float]]:
    """Loads item_id → (x, y) map positions. Missing file just disables user map positions."""
    if not ITEM_COORDINATES_PATH.exists():
        log.warning("%s not found, user map coordinates will not be updated", ITEM_COORDINATES_PATH)
        return {}

    with open(ITEM_COORDINATES_PATH, newline="", encoding="utf-8-sig") as f:
        return {int(row["item_id"]): (float(row["x"]), float(row["y"])) for row in csv.DictReader(f)}


def initialize():
    global index, _item_ids, item_id_to_embedding, item_coordinates, catalog_mean, ready

    try:
        log.info("Fetching embeddings from Supabase")
        item_ids_local, raw = _fetch_embeddings()

        embeddings, mean = center_embeddings(raw)
        del raw

        # Build index. Inner product on unit vectors is cosine similarity.
        idx = faiss.IndexFlatIP(EMBEDDING_DIM)
        idx.add(embeddings)

        # item_id → embedding lookup for building pref vecs
        mapping = {item_id: embeddings[i] for i, item_id in enumerate(item_ids_local)}

        coordinates = _load_item_coordinates()

        _item_ids = item_ids_local
        item_id_to_embedding = mapping
        item_coordinates = coordinates
        catalog_mean = mean
        index = idx
        ready = True
        log.info("Startup complete: index has %d items, %d have map coordinates", idx.ntotal, len(coordinates))
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

    vec = np.array(raw_embedding, dtype=np.float32).reshape(1, EMBEDDING_DIM)
    faiss.normalize_L2(vec)
    centered = vec - catalog_mean
    faiss.normalize_L2(centered)

    with _index_lock:
        index.add(centered)
        _item_ids.append(item_id)
        item_id_to_embedding[item_id] = centered[0]
