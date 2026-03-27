import faiss
import numpy as np
"""
Startup.py Loads the Memory: It pulls that big catalog_embeddings.npy file into RAM so it's ready to go.
It Initializes FAISS: it sets up the IndexFlatL2(512).
It takes a new image (one that isn't already in your catalog), turns it into a vector, and asks FAISS to find the top 5 matches.
"""
# clip documentation shows us 512 dim embeddings
# every item gets embedded and stored here
EMBEDDING_DIM = 512
# IndexFlatL2 is exact KNN using euclidean distance
# "Flat" means no compression, searches every vector
# Good enough for catalogs under 1 million items
# We init here:
index = faiss.IndexFlatL2(EMBEDDING_DIM)

# The embeddings for our catalog will be a 2 dimensional array 
# That means the shape is (num_items, 512)
# data must be float32, float64 doesn't cut it (we'll crash if we try)
catalog_embeddings = np.load("catalog_embeddings.npy").astype(np.float32)

# all item vectors should be appeneded to the index
index.add(catalog_embeddings) # type: ignore 
# the catalog ids need to be loaded from our database:
# gabe this is for you man
# Our data base needs these columns:
# catalog_ids = ["nike_shirt_001", "Gucci_pants_01" ]
# id: A unique string or integer (e.g., nike_shirt_001). This is what you store in your catalog_ids list.

# image_url: The path to the photo so you can actually show it to the user.

# product_page_url: So the user can go buy the item.

# processed_flag: (Crucial!) A true/false column that tells your indexing script, "I've already turned this photo into a vector, don't do it again."