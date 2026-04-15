import faiss
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import faiss
import numpy as np

app = FastAPI()
# how we allow connections
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

catalog_embeddings = np.load("catalog_embeddings1.npy").astype("float32")
index = faiss.IndexFlatL2(512) #IndexFlatL2. It's a brute force search, w/ caching
data_to_add = np.ascontiguousarray(catalog_embeddings.astype('float32'))

index.add(data_to_add)  # type: ignore

# def getRecommendation(swiped_right_embeddings,swiped_right_indices,k=10):
#     # So we are supposed to get likes from Kai, there is a folder ripe with embeddings and image urls
#     query = swiped_right_embeddings.mean(axis = 0,keep_dims=True)
#     # we do this so we don't recommend the things that the user has already liked. The neighbor closest to a point is itself
#     search_k = k + len(swiped_right_indices) # swiped right is a buffer of stuff we IGNORE
#     # Currently, this method is primitive. It assumes that the user likes ALL of the same things.
#     # I'm going to comment it out in favor of one that doesn't have the same issues
#     # The mean between red socks and blue socks might be purple socks, but that doesn't mean the user likes purple socks

# We will have to include this to talk between two different systems
# @app.route("/recommend", methods=["POST"])
# def recommend():
#     liked_items = request.json.get("liked_items", [])  # list of {item_img, ...}

def get_multi_recommendations(swiped_right_embeddings,swiped_right_indices,k=10):
    """
    We get 5 recommendation for each swiped_right item in swiped_right_embeddings
    """
    all_indices = []
    for emb in swiped_right_embeddings:
        # get 20 or so neighbors for everything liked
        # 1 row with 512 columns (gotta be 2d matrix)
        # the index.search is the part where we actually feed the model and ask for neighbors
        _, indices = index.search(emb.reshape(1,-1), 5)  # type: ignore
        all_indices.extend(indices[0])

    seen = set(swiped_right_indices)
    unique_recs = []
    for idx in all_indices:
        if idx not in seen:
            unique_recs.append(idx)
            seen.add(idx)
    return unique_recs[:k]

@app.route("/recommend", methods=["POST"])
def recommend():
    indices = 