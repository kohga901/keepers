import json
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap

with open("metadata.json") as f:
    meta = json.load(f)

# pull x/y and gender straight from the json
xs = [item["tsne_x"] for item in meta]
ys = [item["tsne_y"] for item in meta]
genders = [item["item_gender"] for item in meta]

unique = sorted(set(genders))
colors = [unique.index(g) for g in genders]

my_colors = ["deepskyblue", "gray", "hotpink", "gold", "plum", "cyan", "green", "black"]
my_cmap = ListedColormap(my_colors[:len(unique)])

plt.figure(figsize=(10, 7))
scatter = plt.scatter(xs, ys, c=colors, alpha=0.5, cmap=my_cmap)

cbar = plt.colorbar(scatter, ticks=range(len(unique)))
cbar.ax.set_yticklabels(unique)
cbar.set_label("Gender")

plt.title("CLIP Embeddings Visualized by Gender")
plt.show()