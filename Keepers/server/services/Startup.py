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
# Good enough for an image folder under 1 million items
# We init here:
index = faiss.IndexFlatL2(EMBEDDING_DIM)

# The embeddings for our catalog will be a 2 dimensional array 
# That means the shape is (num_items, 512)
# data must be float32, float64 doesn't cut it (we'll crash if we try)
catalog_embeddings = np.load("catalog_embeddings.npy").astype(np.float32)
# There is a normalize method @KO can u figure out what that is? look into normalize_L2 for Faiss?
# We CAN normalize in the indexing script after line 62? Or u can do it herev 
# norm = 
# embedding / norm?
# or 

# np.save at the end tho


# all item vectors should be appeneded to the index
# index is like google 512-dimension vectors get fed into FAISS
index.add(catalog_embeddings) # type: ignore 
# the catalog ids need to be loaded from our database:
# gabe this is for you man
# Our data base needs these columns:
# catalog_ids = ["nike_shirt_001", "Gucci_pants_01" ]
# id: A unique string or integer (e.g., nike_shirt_001). This is what you store in your catalog_ids list.

# image_url: The path to the photo so you can actually show it to the user.

# product_page_url: So the user can go buy the item.

# processed_flag: (Crucial!) A true/false column that tells your indexing script, "I've already turned this photo into a vector, don't do it again."

# we never set processed flag to true but we'll have to do that for every image, probably right before we run the indexingScript.py
catalog_ids = []

# n is the neighbors
def get_recommendation_for_every_user(user_profiles: dict, n: int = 20, ) -> dict:
    """
    T
    """
    user_ids = list(user_profiles.keys())
    profiles = [user_profiles[uid] for uid in user_ids]
    #profiles = list(map(user_profiles.get, user_profiles))

    # STACK all profiles into 2d Matrix
    # doing this is like what we did to the clothes in indexingScirp
    # This is how we do multiple queries
    profiles_matrix = np.array(profiles, dtype=np.float32) #npstack dont work here

    assert profiles_matrix.ndim == 2
    assert profiles_matrix.shape[1] == index.d

    distancies, indices = index.search(profiles_matrix, k=n)  # type: ignore 

    recommendations = {}
    for i, user_id in enumerate(user_ids):
          recommendations[user_id] = [catalog_ids[idx] for idx in indices[i]]

    return recommendations