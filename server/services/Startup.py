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
import time
import umap

print(f"[{time.time()}] Startup.py: imports done, about to load env vars")

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


def initialize():
    global index, _item_ids, item_id_to_embedding, umap_reducer, ready

    # Fetch all embeddings from Supabase
    client = create_client(SUPABASE_URL, SUPABASE_KEY, options=ClientOptions(postgrest_client_timeout=10))

    print(f"[{time.time()}] Startup.initialize(): fetching embeddings from Supabase")

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

    print(f"[{time.time()}] Startup.initialize(): fetched {len(response.data)} embeddings")
    print(f"[{time.time()}] Startup.initialize(): building FAISS index")
    
    # Parse into aligned lists
    item_ids_local = [int(row["item_id"]) for row in response.data]
    embeddings = np.array([row["embedding"] for row in response.data], dtype=np.float32)

    print(f"[{time.time()}] Startup.initialize(): parsed embeddings into numpy array of shape {embeddings.shape}")
    # Normalize for cosine similarity via IndexFlatIP
    faiss.normalize_L2(embeddings)
    print(f"[{time.time()}] Startup.initialize(): normalized embeddings")


    print(f"[{time.time()}] Startup.initialize(): training UMAP reducer")
    # The umap model is spawned as a model without any training, so we need to train it on the normalized
    # embeddings. This is done here on server boot, and the model is then used in recommendation_service.py
    # to reduce the dimensionality of the preference vector.
    reducer = umap.UMAP(n_components=2, random_state=42)
    reducer.fit(embeddings)
    print(f"[{time.time()}] Startup.initialize(): trained UMAP reducer")

    print(f"[{time.time()}] Startup.initialize(): building FAISS index")
    # Build index
    idx = faiss.IndexFlatIP(EMBEDDING_DIM)
    idx.add(embeddings)
    print(f"[{time.time()}] Startup.initialize(): built FAISS index with {idx.ntotal} items")

    print(f"[{time.time()}] Startup.initialize(): setting global variables for index, item_ids, and item_id_to_embedding")
    # item_id → embedding lookup for pref vec updates
    mapping = {item_id: embeddings[i] for i, item_id in enumerate(item_ids_local)}

    _item_ids = item_ids_local
    item_id_to_embedding = mapping
    umap_reducer = reducer
    index = idx
    ready = True
    print("Startup.initialize() complete — index and UMAP model ready.")