# turn embeddings into json or whatever
import numpy as np
import json
import clip
import torch
import os
from PIL import Image
import requests # new 
from io import BytesIO # new
import logging as log
import sys
import numpy as np
# Plan on doing this: pip install fashion-clip
# from fashion_clip.fashion_clip import FashionCLIP
# import pandas as pd
# fclip = FashionCLIP('fashion-clip')

"""
Clip is OpenAi's clip model from github, gets an embedding for 
each file in the folder of scraped clothing and saves it to an npy
"""


# ---------------------------------------------------------------------------------------
# GLOBAL VARIABLES
# ---------------------------------------------------------------------------------------


log.basicConfig(level=log.DEBUG)

BATCH_SIZE = 32     # Number of clothings the CLIP model will be processing at a time.

# turn on metal if u got it
device = "mps" if torch.backends.mps.is_available() else "cpu"

# Loading the clip model and preprocess.
result = clip.load("ViT-B/32", device=device)
model = result[0]
preprocess = result[1]


# ---------------------------------------------------------------------------------------
# END OF GLOBAL VARIABLES
# ---------------------------------------------------------------------------------------


# ---------------------------------------------------------------------------------------
# FUNCTIONS
# ---------------------------------------------------------------------------------------


def get_embeddings(tensor_batch: torch.Tensor) -> torch.Tensor:
    """
    This function takes a tensor which is a batch of preprocessed images and runs the batch through the CLIP model.
    Returns the extracted batch.
    """

    # Give tensor batch to CLIP and get embedded vectors.
    with torch.no_grad():
        vector_batch = model.encode_image(tensor_batch) # This is where we tell clip, "model", to encode the image and call it vector

    return vector_batch

def is_image(filename: str) -> bool:
    """
    Filters the files and returns only files ending with '.jpg', '.jpeg', '.png'.
    """
    return filename.lower().endswith(('.jpg', '.jpeg', '.png'))


# ---------------------------------------------------------------------------------------
# END OF FUNCTIONS
# ---------------------------------------------------------------------------------------

log.debug("Starting script...\n")
with open("JSON/Clothing_rows.json", "r") as f:
# with open("../../Scrapers/Google/shoppingListingJSON/google_shopping_njfjte_2026-04-01T02-47-25-227Z.json", "r") as f:
    items = json.load(f)
    
log.debug(f"NUMBER OF ITEMS: {len(items)}\n")

log.debug(f"BATCH SIZE: {BATCH_SIZE}\n")


valid_items = []
valid_images = []


# The vectors that the images have been transformed into. 
# Each vector is 512 dim.
for item in items:
    try:
        response = requests.get(item["item_img"], timeout=5)
        response.raise_for_status()
        img = Image.open(BytesIO(response.content)).convert("RGB")
        valid_images.append(preprocess(img).to(device)) # type: ignore
        valid_items.append({
            "item_name": item["item_name"],
            "item_price": item["item_price"],
            "item_gender": item["item_gender"],
            "item_img": item["item_img"],
            "item_web_listing": item["item_web_listing"]
        })
    except Exception as e:
        log.warning(f"failed on {item.get('item_name', 'unknown')}: {e}")

log.debug(f"Successfully Loaded: {len(valid_images)} images")  

if len(valid_images) == 0:
    log.debug(f"NO IMAGES TO EMBED. NUMBER OF IMAGES: {len(valid_images)}\n")
    log.debug(f"EXITING...\n")
    sys.exit()

embedded_vectors = []
# Compute the number of batches required.
num_of_batches = (len(valid_images) + BATCH_SIZE - 1) // BATCH_SIZE
# Get images in batches and convert them to embeddings using the CLIP model.
for batch_num in range(num_of_batches):

    log.debug(f"PROCESSING BATCH NUMBER: {batch_num}.\n")

    # A list (batch) of images that have been fed through preprocess().
    # Batch size is BATCH_SIZE.
    batch_of_processed_images = []

    # Compute the index for getting an image from image_paths.
    start = batch_num * BATCH_SIZE
    end = min(start + BATCH_SIZE, len(valid_images))

    batch_of_processed_images = valid_images[start:end]
    
    tensor = torch.stack(batch_of_processed_images)
    # We can just process the tensor after stacking
    embeddings = get_embeddings(tensor)
    embedded_vectors.append(embeddings.cpu().numpy())

# Put the extracted features from this batch to the total vectors.
catalog_embeddings = np.vstack(embedded_vectors)

enriched_items = []
for item, embedding in zip(valid_items, catalog_embeddings):
    enriched_items.append({
        **item,
        "embedding": embedding.tolist()
    })
log.debug(f"FINISHED EMBEDDINGS.\n")

with open("catalog_with_embeddings.json", "w") as f:
     json.dump(enriched_items, f, indent=2)

np.save("catalog_embeddings1.npy", catalog_embeddings) #.npy is like a bunch of numbers loosely formatted to go to ram, bytes go to memory, faster than csv
with open("metadata.json", "w") as f:
    json.dump(valid_items, f, indent=2)

log.debug(f"Script finished...\n")

