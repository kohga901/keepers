import faiss
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2  #Gabe give guidance

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
class RecommendRequest(BaseModel):
    #swiped_right_indices: list[int]
    uid: str  #UID over Swiped indices


def get_likes_from_db(uid: str) -> list[int]:
    conn = psycopg2.connect("postgresql://...") # gabe add in post pleaseeee
    cur = conn.cursor()
    cur.execute("SELECT item_index FROM likes WHERE user_id = %s", (uid,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [row[0] for row in rows]

@app.post(("/recommend"))
def recommend(body: RecommendRequest):
    likedIndices = get_likes_from_db(body.uid)

    if not likedIndices:
        raise HTTPException(status_code=404, detail="No likes found for this user")
    #embeddings = catalog_embeddings[indices]
    all_indices = []
    for idx in likedIndices:
        # get 20 or so neighbors for everything liked
        # 1 row with 512 columns (gotta be 2d matrix)
        # the index.search is the part where we actually feed the model and ask for neighbors
        emb = catalog_embeddings[idx]  # look up embedding by item index
        _, neighbors = index.search(emb.reshape(1, -1), 5) # type: ignore
        all_indices.extend(neighbors[0].tolist())

    seen = set(likedIndices)
    unique_recs = []
    for idx in all_indices:
        if idx not in seen:
            unique_recs.append(idx)
            seen.add(idx)
    rec_indices = unique_recs[:10]
    return {"recommended_urls": [image_urls[i] for i in rec_indices]}
     # The number her is what we get back
# def get_multi_recommendations(swiped_right_embeddings,swiped_right_indices,k=10):
#     """
#     We get 5 recommendation for each swiped_right item in swiped_right_embeddings
#     """
  


# This code below is suited for getting an array of likes, maybe not what we want yet. We want more User specific likes
# @app.post(("/recommend"))
# def recommend(body: RecommendRequest):
#     indices = body.swiped_right_indices
#     embeddings = catalog_embeddings[indices]
#     all_indices = []
#     for emb in embeddings:
#         # get 20 or so neighbors for everything liked
#         # 1 row with 512 columns (gotta be 2d matrix)
#         # the index.search is the part where we actually feed the model and ask for neighbors
#         _, indices = index.search(emb.reshape(1,-1), 5)  # type: ignore
#         all_indices.extend(indices[0])

#     seen = set(indices)
#     unique_recs = []
#     for idx in all_indices:
#         if idx not in seen:
#             unique_recs.append(idx)
#             seen.add(idx)
#     return unique_recs[:10] # The number her is what we get back
