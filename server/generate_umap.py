import os, faiss, numpy as np, umap, joblib, base64
from supabase import create_client

client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
response = client.table("Embeddings").select("item_id, embedding").execute()
embeddings = np.array([row["embedding"] for row in response.data], dtype=np.float32)
faiss.normalize_L2(embeddings)

reducer = umap.UMAP(n_components=2, random_state=42)
reducer.fit(embeddings)
joblib.dump(reducer, "umap_model.pkl")

with open("umap_model.pkl", "rb") as f:
    print("BASE64_START")
    print(base64.b64encode(f.read()).decode())
    print("BASE64_END")