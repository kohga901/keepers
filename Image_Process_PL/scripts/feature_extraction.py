import argparse
import numpy as np
import clip
import torch
import os
from PIL import Image
import logging as log
import sys

"""
feature_extraction.py 

Final stage of the pipeline.

    - Gets the folder of the filtered clothing
    - Loads OpenAi's clip model from github
    - Gets an embedding for each file in the folder of filtered clothing
    - Saves it to an npy.
"""


# ---------------------------------------------------------------------------------------
# CONFIG SETUP
# ---------------------------------------------------------------------------------------

INPUT_DIR  = "../data/background_filtered"
OUTPUT_DIR = "../data/embedded_vectors"

BATCH_SIZE = 32         # Number of clothes the CLIP model will be processing at a time.

# ---------------------------------------------------------------------------------------
# EMBEDDING CONVERSION AND FILE CONFIG
# ---------------------------------------------------------------------------------------

def get_embeddings(tensor_batch: torch.Tensor, model: clip.model.CLIP) -> torch.Tensor:
    """
    Takes a tensor which is a batch of preprocessed images and runs the batch through the CLIP model.
    Returns the extracted batch.
    """
    with torch.no_grad():
        vector_batch = model.encode_image(tensor_batch)

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
    return os.path.join(INPUT_DIR, filename)


# ---------------------------------------------------------------------------------------
# MAIN LOGIC
# ---------------------------------------------------------------------------------------

def main():

    # Arg parser
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    args = parser.parse_args()

    log.basicConfig(level=log.DEBUG)

    # Making sure the output dir exists.
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(OUTPUT_DIR, "catalog_embeddings.npy")

    # Get all files from input dir.
    files = os.listdir(INPUT_DIR)

    log.debug("Starting script...\n")
    log.debug(f"NUMBER OF ITEMS: {len(files)}\n")

    # Filter out non-image files.
    only_images = list(filter(is_image, files))

    # Apply limit if provided.
    if args.limit is not None:
        only_images = only_images[:args.limit]

    log.debug(f"NUMBER OF CLOTHES AFTER FILTER: {len(only_images)}\n")
    log.debug(f"BATCH SIZE: {BATCH_SIZE}\n")

    # Exit if no images in the folder.
    if len(only_images) == 0:
        log.debug(f"NO IMAGES TO EMBED. NUMBER OF IMAGES: {len(only_images)}\n")
        log.debug(f"EXITING...\n")
        sys.exit()

    # Turn on CUDA, Metal, or fall back to CPU.
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    log.debug(f"DEVICE: {device}\n")

    # Load the CLIP model and preprocessor.
    result     = clip.load("ViT-B/32", device=device)
    model      = result[0]
    preprocess = result[1]

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
        batch_of_processed_images = []

        # Compute the index for getting an image from image_paths.
        start = batch_num * BATCH_SIZE
        end   = min(start + BATCH_SIZE, len(image_paths))

        # Go through each image in a batch and feed it into preprocess().
        for i in range(start, end):

            # Get image from the image_paths list and convert it to a PIL image object.
            # File descriptor is closed after being opened to avoid keeping too many open.
            with Image.open(image_paths[i]) as img:
                img = img.convert("RGB")

            # Put the image through preprocess.
            processed_img = preprocess(img).to(device)

            # Put the processed image in the list.
            batch_of_processed_images.append(processed_img)

        # Merge list of tensors into one big tensor for CLIP.
        tensor = torch.stack(batch_of_processed_images)

        # Put a batch of processed images through the CLIP model.
        embeddings = get_embeddings(tensor, model)

        # Put the embeddings on CPU then convert to numpy.
        embeddings_numpy = embeddings.cpu().numpy()

        # Append batch embeddings to the total list.
        embedded_vectors.append(embeddings_numpy)

    # Stack all batch embeddings into one array.
    catalog_embeddings = np.vstack(embedded_vectors)

    log.debug(f"FINISHED EMBEDDINGS.\n")

    np.save(output_path, catalog_embeddings)

    log.debug(f"Script finished...\n")


if __name__ == "__main__":
    main()