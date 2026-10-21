"""
Startup.py

Builds the FAISS index on server boot by fetching embeddings from Supabase.
Exposes `index`, `_item_ids`, `item_id_to_embedding`, `item_coordinates`, the tag lookups, and
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

from services import bitset

log = logging.getLogger(__name__)

# Length of a CLIP embedding.
EMBEDDING_DIM = 512

# Rows per request when fetching embeddings. Each row is ~12 KB of JSON.
EMBEDDING_PAGE_SIZE = 500

# Two items whose embeddings are at least this similar are treated as the same
# product. The catalog holds some products under more than one item_id (same
# photo, name and listing), and a user must never be shown both copies.
# Identical photos give a similarity of 1.0; the margin only absorbs rounding.
DUPLICATE_SIMILARITY = 0.999

# How many nearest items are checked when looking for an item's duplicates.
DUPLICATE_NEIGHBOURS = 10

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

# item_id → the tags of the item. Items without tags are not in here.
item_tags: dict[int, frozenset[str]] = {}

# tag → the item_ids carrying it, as a bitset (see bitset.py). Tags no item carries are not in here.
tag_items: dict[str, int] = {}

# tag → its category (e.g. "Jeans" → "category"), from the master Tags table.
tag_category: dict[str, str] = {}

# Mean embedding of the catalog, subtracted from every embedding.
catalog_mean = None

# item_id → every item_id of the same product, itself included. Only items that
# have at least one duplicate are in here.
duplicate_groups: dict[int, frozenset[int]] = {}

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


def find_duplicate_groups(idx, embeddings: np.ndarray, item_ids: list[int]) -> dict[int, frozenset[int]]:
    """
    Groups items whose embeddings are near-identical (see DUPLICATE_SIMILARITY).

    Args:
        idx:        FAISS index holding `embeddings`.
        embeddings: (N, 512) unit-length embeddings, in the same order as item_ids.
        item_ids:   item_id of each row.

    Returns:
        item_id → every item_id in its group, for items that have a duplicate.
    """
    # Get the nearest items of every item, and their similarity scores.
    k = min(DUPLICATE_NEIGHBOURS, idx.ntotal)
    scores, indices = idx.search(embeddings, k=k)

    # Each row starts as its own group. parent[row] points towards the group's first row.
    parent = list(range(len(item_ids)))

    def find(row: int) -> int:
        # Follow the pointers up to the first row of the group.
        while parent[row] != row:
            parent[row] = parent[parent[row]]
            row = parent[row]
        return row

    # Join every pair of rows that are similar enough into one group.
    rows, cols = np.nonzero(scores >= DUPLICATE_SIMILARITY)
    for row, col in zip(rows, cols):
        a, b = find(int(row)), find(int(indices[row, col]))
        if a != b:
            parent[max(a, b)] = min(a, b)

    # Collect the item_ids of each group.
    members: dict[int, list[int]] = {}
    for row, item_id in enumerate(item_ids):
        members.setdefault(find(row), []).append(item_id)

    # Keep only groups with more than one item, and look them up by any member.
    groups: dict[int, frozenset[int]] = {}
    for ids in members.values():
        if len(ids) > 1:
            group = frozenset(ids)
            for item_id in ids:
                groups[item_id] = group

    return groups


def duplicates_of(item_id: int) -> frozenset[int] | tuple[int]:
    """Every item_id of the same product as item_id, itself included."""
    return duplicate_groups.get(item_id, (item_id,))


def drop_duplicates(item_ids: list[int]) -> list[int]:
    """Keeps the first item of each product and drops later copies of it, preserving order."""
    # item_ids already covered by an item that was kept.
    covered: set[int] = set()
    kept: list[int] = []

    for item_id in item_ids:
        if item_id not in covered:
            kept.append(item_id)
            covered.update(duplicates_of(item_id))

    return kept


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


def build_tag_lookups(
    tag_rows: list[dict], tagged_rows: list[dict]
) -> tuple[dict[str, str], dict[int, frozenset[str]], dict[str, int]]:
    """
    Turns the rows of the Tags and Tagged_Clothing tables into the lookups used for filtering.

    Args:
        tag_rows:    Rows of {"Tag": ..., "Category": ...}.
        tagged_rows: Rows of {"clothes_id": ..., "Tag": ...}.

    Returns:
        (tag → category, item_id → tags, tag → bitset of item_ids)
    """
    # tag → category.
    categories = {row["Tag"]: row["Category"] for row in tag_rows}

    # item_id → tags, and tag → item_ids.
    tags_of: dict[int, set[str]] = {}
    items_of: dict[str, int] = {}
    for row in tagged_rows:
        item_id, tag = int(row["clothes_id"]), row["Tag"]
        tags_of.setdefault(item_id, set()).add(tag)
        items_of[tag] = bitset.with_bit(items_of.get(tag, bitset.EMPTY), item_id)

    return categories, {i: frozenset(t) for i, t in tags_of.items()}, items_of


def resolve_filter(selected_tags: list[str]) -> set[int] | None:
    """
    Works out which items satisfy a tag filter. Tags of the same category are
    alternatives (OR), and different categories must all be satisfied (AND), so
    ["Jeans", "Pants", "Black"] means (Jeans or Pants) and Black.

    Args:
        selected_tags: The tags the user picked. An empty list means no filter.

    Returns:
        The set of matching item_ids, or None if there is no filter. A tag that
        doesn't exist matches nothing.
    """
    # No tags selected, so every item is allowed.
    if not selected_tags:
        return None

    # Group the selected tags by category. A tag with no known category is its own group.
    groups: dict[str, set[str]] = {}
    for tag in selected_tags:
        groups.setdefault(tag_category.get(tag, tag), set()).add(tag)

    # Snapshot under the lock so an admin upload can't change the sets mid-read.
    with _index_lock:
        # Items matching at least one tag of each group...
        per_group = [bitset.union(tag_items.get(tag, bitset.EMPTY) for tag in tags) for tags in groups.values()]

    # ...and then items matching every group.
    return bitset.to_set(bitset.intersection(per_group))


def _fetch_tags() -> tuple[list[dict], list[dict]]:
    """
    DB function. Fetches every row of the Tags and Tagged_Clothing tables.
    """
    # Imported here so this module can be used without Supabase credentials
    # (see tools/simulate_recommendations.py).
    from db import supabase, supabase_fetch_all

    # SELECT Tag, Category FROM "Tags" ORDER BY Tag
    tag_query = lambda: supabase.table("Tags").select("Tag, Category").order("Tag")

    # SELECT clothes_id, Tag FROM "Tagged_Clothing" ORDER BY clothes_id, Tag
    tagged_query = lambda: supabase.table("Tagged_Clothing").select("clothes_id, Tag").order("clothes_id").order("Tag")

    tag_rows = [row for page in supabase_fetch_all(tag_query) for row in page]
    tagged_rows = [row for page in supabase_fetch_all(tagged_query) for row in page]
    return tag_rows, tagged_rows


def add_item_tags(item_id: int, tags: list[str]) -> None:
    """
    Adds a freshly-uploaded item's tags to the in-memory tag lookups so the item
    shows up under filters without a server restart. Tags that aren't in the
    master Tags table are ignored (the upload rejects them anyway).
    """
    # Nothing to add.
    if not tags:
        return

    with _index_lock:
        known = [tag for tag in tags if tag in tag_category]
        item_tags[item_id] = frozenset(known)
        for tag in known:
            tag_items[tag] = bitset.with_bit(tag_items.get(tag, bitset.EMPTY), item_id)


def initialize():
    global index, _item_ids, item_id_to_embedding, item_coordinates, catalog_mean, duplicate_groups, ready
    global item_tags, tag_items, tag_category

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

        # Find the items that are copies of the same product.
        groups = find_duplicate_groups(idx, embeddings, item_ids_local)
        log.info("Found %d items that are copies of another item (%d products stored more than once)",
                 len(groups), len(set(groups.values())))

        # Load the map position of each item.
        coordinates = _load_item_coordinates()

        # Load the tags, for filtering. Without them filters match nothing, but
        # recommendations still work, so a failure here shouldn't stop the server.
        try:
            categories, tags_of, items_of = build_tag_lookups(*_fetch_tags())
            log.info("Loaded %d tags covering %d items", len(categories), len(tags_of))
        except Exception:
            log.exception("Failed to load tags, filters will match nothing")
            categories, tags_of, items_of = {}, {}, {}

        # Set the global variables, with ready last so nothing is read half-built.
        _item_ids = item_ids_local
        item_id_to_embedding = mapping
        item_coordinates = coordinates
        catalog_mean = mean
        duplicate_groups = groups
        tag_category = categories
        item_tags = tags_of
        tag_items = items_of
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
        # Look for existing items that are the same product as the new one.
        scores, indices = index.search(centered, k=min(DUPLICATE_NEIGHBOURS, index.ntotal))
        same = [_item_ids[idx] for idx, score in zip(indices[0], scores[0]) if score >= DUPLICATE_SIMILARITY]

        # Put the new item and everything it matches into one group.
        if same:
            group = frozenset({item_id}).union(*(duplicates_of(i) for i in same))
            for member in group:
                duplicate_groups[member] = group

        index.add(centered)
        _item_ids.append(item_id)
        item_id_to_embedding[item_id] = centered[0]
