"""
Startup.py

Builds the FAISS index on server boot by fetching embeddings from Supabase.
Exposes `index`, `_item_ids`, `item_id_to_embedding`, and `EMBEDDING_DIM`
for use by recommendation_service.py and clothes.py.
"""

import faiss
import numpy as np
from dotenv import load_dotenv
from pathlib import Path
from supabase import create_client
import os
import time
import joblib

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

UMAP_MODEL_PATH = Path(__file__).resolve().parents[1] / "data" / "embedded_vectors" / "umap_model.pkl"
umap_reducer = joblib.load(UMAP_MODEL_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

EMBEDDING_DIM = 512

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

# Fetch all embeddings from Supabase
client  = create_client(SUPABASE_URL, SUPABASE_KEY)


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
_item_ids   = [int(row["item_id"])      for row in response.data]
_embeddings = np.array([row["embedding"] for row in response.data], dtype=np.float32)

# Normalize for cosine similarity via IndexFlatIP
faiss.normalize_L2(_embeddings)

# Build index
index = faiss.IndexFlatIP(EMBEDDING_DIM)
index.add(_embeddings)

# item_id → embedding lookup for pref vec updates
item_id_to_embedding = {
    item_id: _embeddings[i]
    for i, item_id in enumerate(_item_ids)
}