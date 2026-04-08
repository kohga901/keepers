import numpy as np
import json
import matplotlib.pyplot as plt
from sklearn.manifold import TSNE
from matplotlib.colors import ListedColormap
# We have to run the feature_exctraction.py first
data = np.load("catalog_embeddings1.npy")


# we wnat to Load and process our metadata for coloring
with open("metadata.json") as f:
    meta = json.load(f)

genders = [item["item_gender"] for item in meta]
# This unique sort here makes it so the colors stay static
unique = sorted(list(set(genders)))
colors = [unique.index(g) for g in genders]



# Reducing to 2D so vectors no longer has 512 dimensions -> Becoems a map
reduced = TSNE(n_components=2, random_state=70).fit_transform(data)
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