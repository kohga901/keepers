import faiss
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2  #Gabe give guidance
import json

with open("metadata.json") as f:
    catalog = json.load(f)

image_urls = [item["item_img"] for item in catalog]

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


class RecommendRequest(BaseModel):
    uid: str  #UID over Swiped indices


def get_likes_from_db(uid: str) -> list[int]:
    conn = psycopg2.connect("postgresql://...") # gabe add in post pleaseeee
    cur = conn.cursor()
    cur.execute("SELECT item_index FROM likes WHERE user_id = %s", (uid,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [row[0] for row in rows]

@app.post("/recommend")
def recommend(body: RecommendRequest):
    likedIndices = get_likes_from_db(body.uid)

    if not likedIndices:
        raise HTTPException(status_code=404, detail="No likes found for this user")

    all_indices = []
    for idx in likedIndices:
        emb = catalog_embeddings[idx]
        _, neighbors = index.search(emb.reshape(1, -1), 5) # type: ignore
        all_indices.extend(neighbors[0].tolist())

    seen = set(likedIndices)
    unique_recs = []
    for idx in all_indices:
        if idx not in seen:
            unique_recs.append(idx)
            seen.add(idx)

    rec_indices = unique_recs[:10]
    # return full item objects instead of just URLs
    results = [
        {
            "item_img": catalog[i]["item_img"],
            "item_name": catalog[i]["item_name"],
            "item_price": catalog[i]["item_price"],
            "item_web_listing": catalog[i]["item_web_listing"],
        }
        for i in rec_indices
    ]
    return {"recommendations": results}