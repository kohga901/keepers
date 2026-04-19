import faiss
import numpy as np
from pathlib import Path

"""
Startup.py.

This script builds the FAISS index for every clothing in our DB.

      - Loads the Memory: Builds the FAISS index and stores it into RAM. 
      - It Initializes FAISS: it sets up the IndexFlatL2(512).
      - Returns K nearest embeddings that have not been seen by the user.


NOTE: Currently no DB connections for fetching embeddings has been set up. 
The embeddings are accessed from local storage in "ROOT/Image_Process_Pipeline/data/embedded_vectors/" 
path. In the future, the pipeline and the index builder will most likely be on seperate endpoints (local and server).
"""

# Resolve paths relative to this file up to repo root
_ROOT = Path(__file__).resolve().parents[2]
_EMBEDDINGS_PATH = _ROOT / "Image_Process_PL" / "data" / "embedded_vectors" / "catalog_embeddings.npy"
_IDS_PATH        = _ROOT / "Image_Process_PL" / "data" / "embedded_vectors" / "catalog_ids.npy"

EMBEDDING_DIM = 512

# Load embeddings and their corresponding item_id's into disk.
_embeddings = np.load(_EMBEDDINGS_PATH).astype(np.float32)
_item_ids   = np.load(_IDS_PATH, allow_pickle=True).tolist()

# Normalize the length of all vectors so their length is not a factor in similarity search.
faiss.normalize_L2(_embeddings)

# Build index
# Using IndexFlatIP for directional relativity rather than IndexFlatL2 which is for magnitude. This is because the CLIP model
# produces an embedding that is based on directional value. Although L2 can be used, we would have to remove normalization.
index = faiss.IndexFlatIP(EMBEDDING_DIM)        # Create empty index
index.add(_embeddings)                          # Add embeddings

item_id_to_embedding = {
    item_id: _embeddings[i]
    for i, item_id in enumerate(_item_ids)
}