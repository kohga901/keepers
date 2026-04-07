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


"""
Clip is OpenAi's clip model from github, gets an embedding for 
each file in the folder of scraped clothing and saves it to an npy
"""


# ---------------------------------------------------------------------------------------
# GLOBAL VARIABLES
# ---------------------------------------------------------------------------------------


log.basicConfig(level=log.DEBUG)

BATCH_SIZE = 32     # Number of clothings the CLIP model will be processing at a time.

# init, the folder path is the clothing folder
# jsonFile_path = ../Scrapers/Google/shoppingListingJSON/google_shopping_njfjte_2026-04-01T02-47-25-227Z
# for img in jsonFile_path:
#   image_path.append()
# folder_path = "../Backgroun#d_Filtered_Images" # this is where we would get the clothes we scraped...IF WE HAD ANY
# all_files = os.listdir(folder_path)

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

# def to_full_path(filename: str) -> str: 
#     """
#     Builds the full path name to a file.
#     """
#     return os.path.join(folder_path, filename)


# ---------------------------------------------------------------------------------------
# END OF FUNCTIONS
# ---------------------------------------------------------------------------------------

log.debug("Starting script...\n")
with open("../../Scrapers/Google/shoppingListingJSON/google_shopping_njfjte_2026-04-01T02-47-25-227Z.json", "r") as f:
    items = json.load(f)
    
log.debug(f"NUMBER OF ITEMS: {len(items)}\n")

# filter = trim the non images from all files
#only_images = list(filter(is_image, all_files))

#log.debug(f"NUMBER OF CLOTHES AFTER FILTER: {len(only_images)}\n")
log.debug(f"BATCH SIZE: {BATCH_SIZE}\n")

# Exit if no images in the folder.
# if (len(items) == 0):
#     log.debug(f"NO IMAGES TO EMBED. NUMBER OF IMAGES: {len(only_images)}\n")
#     log.debug(f"EXITING...\n")
#     sys.exit()

# Path of every image.
#image_paths = list(map(to_full_path, only_images))
valid_items = []
valid_images = []
# Compute the number of batches required.
#num_of_batches = (len(image_paths) + (BATCH_SIZE - 1)) // BATCH_SIZE

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
    
    # # Now the list of tensors in "processed_images_batch" must be merged into one big tensor.
    # # Reason for this is because the CLIP model expects one tensor.
    # tensor = torch.stack(batch_of_processed_images)

    # # Put a batch of processed images through the CLIP model.
    # embeddings = get_embeddings(tensor)

    # # Put the embeddings on cpu.
    # # Then convert the tensors to numpy.
    # embeddings_numpy = embeddings.cpu().numpy()
    
    # # Put the embeddings in the vector array.
    # embedded_vectors.append(embeddings_numpy)

# Put the extracted features from this batch to the total vectors.
catalog_embeddings = np.vstack(embedded_vectors)

log.debug(f"FINISHED EMBEDDINGS.\n")

np.save("catalog_embeddings.npy", catalog_embeddings) #.npy is like a bunch of numbers loosely formatted to go to ram, bytes go to memory, faster than csv
with open("metadata.json", "w") as f:
    json.dump(valid_items, f, indent=2)

log.debug(f"Script finished...\n")

# data = np.load("catalog_embeddings.npy")

# # reduced = TSNE(n_components=2, random_state=42).fit_transform(data)
# # plt.scatter(reduced[:, 0], reduced[:, 1], alpha=0.5)
# # plt.title("CLIP Embeddings")
# # plt.show()