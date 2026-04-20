"""
generate_coordinates.py

Reduces 512-dim CLIP embeddings to 2D XY coordinates using UMAP.
Outputs a CSV file with item_id, x, y for each item.

Usage:
    python generate_coordinates.py
"""

import numpy as np
import umap
import csv
import os
from logger import setup_logging

EMBEDDINGS_PATH = "../data/embedded_vectors/catalog_embeddings.npy"
IDS_PATH        = "../data/embedded_vectors/catalog_ids.npy"
OUTPUT_PATH     = "../data/csv/coordinates.csv"
LOG_PATH        = "../logs/generate_coordinates.log"


def main():
    logger = setup_logging(LOG_PATH)

    logger.info("Loading embeddings...")
    embeddings = np.load(EMBEDDINGS_PATH).astype(np.float32)
    item_ids   = np.load(IDS_PATH, allow_pickle=True).tolist()
    logger.info(f"Loaded {len(embeddings)} embeddings.")

    logger.info("Running UMAP dimensionality reduction...")
    reducer = umap.UMAP(n_components=2, random_state=42)
    coords  = reducer.fit_transform(embeddings)
    logger.info("UMAP complete.")

    logger.info(f"Saving coordinates to {OUTPUT_PATH}...")
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    

    # Sort by numeric item_id before writing
    sorted_data = sorted(zip(item_ids, coords), key=lambda x: int(x[0]))

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["item_id", "x", "y"])
        for item_id, coord in sorted_data:
            writer.writerow([item_id, coord[0], coord[1]])

    logger.info(f"Done. Saved {len(item_ids)} coordinates to {OUTPUT_PATH}")

    print("\n--- Summary ---")
    print(f"  Items processed: {len(item_ids)}")
    print(f"  Output: {OUTPUT_PATH}\n")


if __name__ == "__main__":
    main()