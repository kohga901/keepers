import numpy as np
import clip
import torch
import os
from PIL import Image
import logging as log
import sys

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
folder_path = "../Background_Filtered_Images" # this is where we would get the clothes we scraped...IF WE HAD ANY
all_files = os.listdir(folder_path)

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

def to_full_path(filename: str) -> str: 
    """
    Builds the full path name to a file.
    """
    return os.path.join(folder_path, filename)


# ---------------------------------------------------------------------------------------
# END OF FUNCTIONS
# ---------------------------------------------------------------------------------------

log.debug("Starting script...\n")
log.debug(f"NUMBER OF ITEMS: {len(all_files)}\n")

# filter = trim the non images from all files
only_images = list(filter(is_image, all_files))

log.debug(f"NUMBER OF CLOTHES AFTER FILTER: {len(only_images)}\n")
log.debug(f"BATCH SIZE: {BATCH_SIZE}\n")

# Exit if no images in the folder.
if (len(only_images) == 0):
    log.debug(f"NO IMAGES TO EMBED. NUMBER OF IMAGES: {len(only_images)}\n")
    log.debug(f"EXITING...\n")
    sys.exit()

# Path of every image.
image_paths = list(map(to_full_path, only_images))

# Compute the number of batches required.
num_of_batches = (len(image_paths) + (BATCH_SIZE - 1)) // BATCH_SIZE

# The vectors that the images have been transformed into. 
# Each vector is 512 dim.
embedded_vectors = []

# Get images in batches and convert them to embeddings using the CLIP model.
for batch_num in range(num_of_batches):

    log.debug(f"PROCESSING BATCH NUMBER: {batch_num}.\n")

    # A list (batch) of images that have been fed through preprocess().
    # Batch size is BATCH_SIZE.
    batch_of_processed_images = []

    # Compute the index for getting an image from image_paths.
    start = batch_num * BATCH_SIZE
    end = min(start + BATCH_SIZE, len(image_paths))

    # Go though each image in a batch and feed it into preprocess().
    for i in range(start, end):

        # Get image from the image_paths list and convert it to a PIL image object.
        # Shouldn't keep too many image files open, so the file descriptor is closed after being opened. 
        # (Honestly we won't be opening too many image files at once but just to be safe.)
        with Image.open(image_paths[i]) as img:
            img = img.convert("RGB")

        # Put the image through preprocess. 
        processed_img = preprocess(img).to(device) # type: ignore

        # Put the processed image in the list.
        batch_of_processed_images.append(processed_img)
    
    # Now the list of tensors in "processed_images_batch" must be merged into one big tensor.
    # Reason for this is because the CLIP model expects one tensor.
    tensor = torch.stack(batch_of_processed_images)

    # Put a batch of processed images through the CLIP model.
    embeddings = get_embeddings(tensor)

    # Put the embeddings on cpu.
    # Then convert the tensors to numpy.
    embeddings_numpy = embeddings.cpu().numpy()
    
    # Put the embeddings in the vector array.
    embedded_vectors.append(embeddings_numpy)

# Put the extracted features from this batch to the total vectors.
catalog_embeddings = np.vstack(embedded_vectors)

log.debug(f"FINISHED EMBEDDINGS.\n")

np.save("catalog_embeddings.npy", catalog_embeddings) #.npy is like a bunch of numbers loosely formatted to go to ram, bytes go to memory, faster than csv

log.debug(f"Script finished...\n")