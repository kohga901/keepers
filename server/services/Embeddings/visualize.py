import numpy as np
import json
import matplotlib.pyplot as plt
from sklearn.manifold import TSNE
from matplotlib.colors import ListedColormap
from sklearn.decomposition import PCA

# faster t-SNE: PCA first to 50, then t-SNE to 2


# We have to run the feature_exctraction.py first
data = np.load("catalog_embeddings1.npy")


# we wnat to Load and process our metadata for coloring
with open("JSON/Clothing_rows.json") as f:
    meta = json.load(f)

genders = [item["item_gender"] for item in meta]
# This unique sort here makes it so the colors stay static
unique = sorted(list(set(genders)))
colors = [unique.index(g) for g in genders]

# To be honest, reduced PCA (reducing from 512 to 50) might be encessary as we do 200k items in a db, but for a demo, 
# regular TSNE might be enough at least for the first semester
# reduced_pca = PCA(n_components=50).fit_transform(data)
# reduced = TSNE(n_components=2, random_state=70).fit_transform(reduced_pca)
# Reducing to 2D so vectors no longer has 512 dimensions -> Becoems a map
reduced = TSNE(n_components=2, random_state=70).fit_transform(data)

# Write x/y back into the JSON
for i, item in enumerate(meta):
    item["tsne_x"] = float(reduced[i, 0])
    item["tsne_y"] = float(reduced[i, 1])

with open("metadata.json", "w") as f:
    json.dump(meta, f, indent=2)

my_colors = ["deepskyblue", "gray" , "hotpink", "gold", "plum", "cyan", "green", "black"]
my_cmap = ListedColormap(my_colors[:len(unique)])
# Create the visualization
plt.figure(figsize=(10, 7))
scatter = plt.scatter(
    reduced[:, 0], 
    reduced[:, 1], 
    c=colors, 
    alpha=0.5, 
    cmap=my_cmap
)

# This creates a colorbar and labels it with your unique genders
cbar = plt.colorbar(scatter, ticks=range(len(unique)))
cbar.ax.set_yticklabels(unique)
cbar.set_label("Gender")

plt.title("CLIP Embeddings Visualized by Gender")
plt.show()