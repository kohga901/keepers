import numpy as np
import json
import torch
import os
from PIL import Image
import requests # new
from io import BytesIO # new
import logging as log
import sys
import numpy as np
from transformers import CLIPModel, CLIPProcessor


"""
feature_extraction_FashionClip.py

FashionCLIP (patrickjohncyh/fashion-clip) is a CLIP ViT-B/32 model fine-tuned
on fashion product images/text. It still produces 512-dim image embeddings,
so it's a drop-in replacement for OpenAI CLIP in this pipeline -- FAISS index,
pgvector column, and preference vectors all stay the same shape.
"""


# ---------------------------------------------------------------------------------------
# GLOBAL VARIABLES
# ---------------------------------------------------------------------------------------


log.basicConfig(level=log.DEBUG)

BATCH_SIZE = 32     # Number of clothings the FashionCLIP model will be processing at a time.

# turn on metal if u got it
device = "mps" if torch.backends.mps.is_available() else "cpu"

# Loading the FashionCLIP model and processor.
MODEL_NAME = "patrickjohncyh/fashion-clip"
model = CLIPModel.from_pretrained(MODEL_NAME).to(device)
model.eval()
processor = CLIPProcessor.from_pretrained(MODEL_NAME)


# ---------------------------------------------------------------------------------------
# END OF GLOBAL VARIABLES
# ---------------------------------------------------------------------------------------


# ---------------------------------------------------------------------------------------
# FUNCTIONS
# ---------------------------------------------------------------------------------------


def get_embeddings(pil_images: list) -> np.ndarray:
    """
    This function takes a list of PIL images and runs them through the
    FashionCLIP model. Returns the extracted batch as a numpy array.
    """

    inputs = processor(images=pil_images, return_tensors="pt").to(device)

    with torch.no_grad():
        vector_batch = model.get_image_features(**inputs)

    return vector_batch.cpu().numpy()

def is_image(filename: str) -> bool:
    """
    Filters the files and returns only files ending with '.jpg', '.jpeg', '.png'.
    """
    return filename.lower().endswith(('.jpg', '.jpeg', '.png'))


# ---------------------------------------------------------------------------------------
# END OF FUNCTIONS
# ---------------------------------------------------------------------------------------

log.debug("Starting script...\n")
with open("JSON/metadataStable.json", "r") as f:
# with open("../../Scrapers/Google/shoppingListingJSON/google_shopping_njfjte_2026-04-01T02-47-25-227Z.json", "r") as f:
    items = json.load(f)

log.debug(f"NUMBER OF ITEMS: {len(items)}\n")

log.debug(f"BATCH SIZE: {BATCH_SIZE}\n")


valid_items = []
valid_images = []


# The images that will be transformed into vectors.
# Each vector is 512 dim.
for item in items:
    try:
        response = requests.get(item["item_img"], timeout=5)
        response.raise_for_status()
        img = Image.open(BytesIO(response.content)).convert("RGB")
        valid_images.append(img)
        valid_items.append({
            "item_name": item["item_name"],
            "item_price": item["item_price"],
            "item_gender": item["item_gender"],
            "item_img": item["item_img"],
            "item_web_listing": item["item_web_listing"],
            "item_id": item["item_id"] # Gabe added this recently.
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
# Get images in batches and convert them to embeddings using the FashionCLIP model.
for batch_num in range(num_of_batches):

    log.debug(f"PROCESSING BATCH NUMBER: {batch_num}.\n")

    # Compute the index for getting an image from valid_images.
    start = batch_num * BATCH_SIZE
    end = min(start + BATCH_SIZE, len(valid_images))

    batch_of_images = valid_images[start:end]

    embeddings = get_embeddings(batch_of_images)
    embedded_vectors.append(embeddings)

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
