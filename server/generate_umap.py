"""
This script generates a UMAP model fit on the embeddings. 
It is intended to run LOCALLY, not on the server. Because the server
is running on Render, it cannot run UMAP due to the lack of a GPU. 
Once the model is generated, it is saved to data/embedded_vectors/umap_model.pkl and
uploaded to Supabase. The server will then download the model from Supabase and use it for dimensionality reduction.

"""

import os, faiss, numpy as np, umap, joblib, io
from supabase import create_client
from dotenv import load_dotenv
load_dotenv()

client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
response = client.table("Embeddings").select("item_id, embedding").execute()
embeddings = np.array([row["embedding"] for row in response.data], dtype=np.float32)
faiss.normalize_L2(embeddings)

reducer = umap.UMAP(n_components=2, random_state=42)
reducer.fit(embeddings)

buf = io.BytesIO()
joblib.dump(reducer, buf)
buf.seek(0)
client.storage.from_("ml-models").upload("umap_model.pkl", buf.read(), {"upsert": "true"})
print("uploaded")