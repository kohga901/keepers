"""
Startup.py

Builds the FAISS index on server boot by fetching embeddings from Supabase.
Exposes `index`, `_item_ids`, `item_id_to_embedding`, and `EMBEDDING_DIM`
for use by recommendation_service.py and clothes.py.

initialize() is called once, in a background thread, from main.py's startup event.
It used to run at import time, which blocked uvicorn from binding a port before
Render's port-scan timeout killed the deploy.
"""

import faiss
import numpy as np
from dotenv import load_dotenv
from pathlib import Path
from supabase import create_client, ClientOptions
import os
import threading
import time
import umap

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

EMBEDDING_DIM = 512

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

index = None
_item_ids = None
item_id_to_embedding = None
umap_reducer = None
ready = False

# Guards mutation of index / _item_ids / item_id_to_embedding so a newly
# uploaded item (see routers/admin.py) can't race with a concurrent
# recommendations lookup that reads them mid-update.
_index_lock = threading.Lock()


def initialize():
    global index, _item_ids, item_id_to_embedding, umap_reducer, ready

    # Fetch all embeddings from Supabase
    client = create_client(SUPABASE_URL, SUPABASE_KEY, options=ClientOptions(postgrest_client_timeout=10))

    for attempt in range(MAX_RETRIES):
        try:
            response = client.table("Embeddings").select("item_id, embedding").execute()
            if response.data:
                break
        except Exception as e:
            print(f"Attempt {attempt + 1} failed: {e}")
            if attempt < MAX_RETRIES - 1:
                print(f"Retrying in {RETRY_DELAY} seconds...")
                time.sleep(RETRY_DELAY)
    else:
        raise RuntimeError("Failed to fetch embeddings from Supabase after 3 attempts. Server cannot start.")

    # Parse into aligned lists
    item_ids_local = [int(row["item_id"]) for row in response.data]
    embeddings = np.array([row["embedding"] for row in response.data], dtype=np.float32)

    # Normalize for cosine similarity via IndexFlatIP
    faiss.normalize_L2(embeddings)

    # The umap model is spawned as a model without any training, so we need to train it on the normalized
    # embeddings. This is done here on server boot, and the model is then used in recommendation_service.py
    # to reduce the dimensionality of the preference vector.
    reducer = umap.UMAP(n_components=2, random_state=42)
    reducer.fit(embeddings)

    # Build index
    idx = faiss.IndexFlatIP(EMBEDDING_DIM)
    idx.add(embeddings)

    # item_id → embedding lookup for pref vec updates
    mapping = {item_id: embeddings[i] for i, item_id in enumerate(item_ids_local)}

    _item_ids = item_ids_local
    item_id_to_embedding = mapping
    umap_reducer = reducer
    index = idx
    ready = True
    print("Startup.initialize() complete — index and UMAP model ready.")


def add_item_embedding(item_id: int, raw_embedding: np.ndarray) -> None:
    """
    Adds a freshly-uploaded item's embedding to the in-memory FAISS index so it
    is immediately eligible for recommendations, without waiting for a server
    restart. Mirrors the normalization done in initialize().

    Args:
        item_id:       The item's id, already inserted into the Clothing/Embeddings tables.
        raw_embedding: The item's raw (un-normalized) 512-dim CLIP embedding.
    """
    if not ready:
        # Nothing to update yet — the next full initialize() will pick this
        # item up from Supabase anyway.
        return

    vec = np.array(raw_embedding, dtype=np.float32).reshape(1, EMBEDDING_DIM)
    normalized = vec.copy()
    faiss.normalize_L2(normalized)

    with _index_lock:
        index.add(normalized)
        _item_ids.append(item_id)
        item_id_to_embedding[item_id] = normalized[0]