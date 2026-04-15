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


# # The embeddings for our catalog will be a 2 dimensional array 
# # That means the shape is (num_items, 512)
# # data must be float32, float64 doesn't cut it (we'll crash if we try)

# # There is a normalize method @KO can u figure out what that is? look into normalize_L2 for Faiss?
# # We CAN normalize in the indexing script after line 62? Or u can do it herev 
# # norm = 
# # embedding / norm?
# # or 

# # np.save at the end tho


# # all item vectors should be appeneded to the index
# # index is like google 512-dimension vectors get fed into FAISS
# index.add(catalog_embeddings) # type: ignore 
# # the catalog ids need to be loaded from our database:
# # gabe this is for you man
# # Our data base needs these columns:
# # catalog_ids = ["nike_shirt_001", "Gucci_pants_01" ]
# # id: A unique string or integer (e.g., nike_shirt_001). This is what you store in your catalog_ids list.

# # image_url: The path to the photo so you can actually show it to the user.

# # product_page_url: So the user can go buy the item.

# # processed_flag: (Crucial!) A true/false column that tells your indexing script, "I've already turned this photo into a vector, don't do it again."

# # we never set processed flag to true but we'll have to do that for every image, probably right before we run the indexingScript.py
# catalog_ids = []

# # n is the neighbors
# def get_recommendation_for_every_user(user_profiles: dict, n: int = 20, ) -> dict:
#     """
#     T
#     """
#     user_ids = list(user_profiles.keys())
#     profiles = [user_profiles[uid] for uid in user_ids]
#     #profiles = list(map(user_profiles.get, user_profiles))

#     # STACK all profiles into 2d Matrix
#     # doing this is like what we did to the clothes in indexingScirp
#     # This is how we do multiple queries
#     profiles_matrix = np.array(profiles, dtype=np.float32) #npstack dont work here

#     assert profiles_matrix.ndim == 2
#     assert profiles_matrix.shape[1] == index.d

#     distancies, indices = index.search(profiles_matrix, k=n)  # type: ignore 

#     recommendations = {}
#     for i, user_id in enumerate(user_ids):
#           recommendations[user_id] = [catalog_ids[idx] for idx in indices[i]]

#     return recommendations