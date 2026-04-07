import numpy as np
import json
import matplotlib.pyplot as plt
from sklearn.manifold import TSNE

data = np.load("catalog_embeddings.npy")


# we wnat to Load and process our metadata for coloring
with open("metadata.json") as f:
    meta = json.load(f)

genders = [item["item_gender"] for item in meta]
unique = sorted(list(set(genders)))
colors = [unique.index(g) for g in genders]



# Reduce to 2D
reduced = TSNE(n_components=2, random_state=42).fit_transform(data)

# Create the visualization
plt.figure(figsize=(10, 7))
scatter = plt.scatter(
    reduced[:, 0], 
    reduced[:, 1], 
    c=colors, 
    alpha=0.5, 
    cmap="tab10"
)

# This creates a colorbar and labels it with your unique genders
cbar = plt.colorbar(scatter, ticks=range(len(unique)))
cbar.ax.set_yticklabels(unique)
cbar.set_label("Gender")

plt.title("CLIP Embeddings Visualized by Gender")
plt.show()