"""
feature_extraction.py 

Final stage of the pipeline.

    - Gets the folder of the filtered clothing
    - Loads OpenAi's clip model from github
    - Gets an embedding for each file in the folder of filtered clothing
    - Saves embeddings and corresponding item IDs to npy files.
"""

import argparse
import numpy as np
import clip
import torch
import os
from PIL import Image
import logging
from logger import setup_logging
import sys


# ---------------------------------------------------------------------------------------
# CONFIG SETUP
# ---------------------------------------------------------------------------------------

INPUT_DIR  = "../data/background_filtered"
OUTPUT_DIR = "../data/embedded_vectors"
LOG_DIR    = "../logs/feature_extraction.log"

# ---------------------------------------------------------------------------------------
# Main feature extraction logic
# ---------------------------------------------------------------------------------------

def get_embeddings(batch_size: int, 
                   file_paths: list[str],
                   item_ids: list[str],
                   device: str, 
                   logger: logging.Logger, 
                   model: clip.model.CLIP, 
                   preprocess: clip.model.Compose) -> torch.Tensor:
    """
    Takes file paths and puts them through preprocess and model in batches. 

    Args:
        batch_size: size of the batch.
        file_paths: the image file paths.
        item_ids: the item IDs corresponding to each file path.
        device: device for running computations. 
        logger: logger
        model: clip.model.CLIP
        preprocess: clip.model.Compose

    Returns embeddings tensor, successful item IDs, and summary counts.
    """
    # All the embeddings.
    embeddings        = []
    successful_ids    = []  # item IDs that successfully processed, aligned with embeddings
    errors            = 0
    processed         = 0

    # Compute the number of batches required.
    num_of_batches = (len(file_paths) + (batch_size - 1)) // batch_size

    # Get images in batches and convert them to embeddings using the CLIP model.
    for batch_num in range(num_of_batches):

        logger.info(f"Processing batch number: {batch_num}.")

        # A list (batch) of images that have been fed through preprocess().
        batch_of_processed_images = []

        # Item IDs for this batch that successfully processed.
        batch_ids = []

        # Compute the index for getting an image from image_paths.
        start = batch_num * batch_size
        end   = min(start + batch_size, len(file_paths))

        # Go through each image in a batch and feed it into preprocess().
        for i in range(start, end):

            try:
                # Get image from the image_paths list and convert it to a PIL image object.
                # File descriptor is closed after being opened to avoid keeping too many open.
                with Image.open(file_paths[i]) as img:
                    img = img.convert("RGB")

                # Put the image through preprocess.
                processed_img = preprocess(img).to(device)

                # Put the processed image and its item ID in the batch lists.
                batch_of_processed_images.append(processed_img)
                batch_ids.append(item_ids[i])
                processed += 1

            # If preprocessing fails.
            except Exception:
                logger.error(f"Failed to process image: {file_paths[i]} in batch number: {batch_num}")
                errors += 1
                continue

        # If every image in the batch fails, skip to next batch.
        if not batch_of_processed_images:
            logger.warning(f"Batch {batch_num} had no valid images, skipping.")
            continue

        # Put the tensors into one big tensor for CLIP.
        tensor = torch.stack(batch_of_processed_images)

        # Run batch through CLIP model.
        with torch.no_grad():
            vector_batch = model.encode_image(tensor)

        # Add embeddings and their corresponding IDs.
        embeddings.append(vector_batch)
        successful_ids.extend(batch_ids)

    total = processed + errors

    return torch.cat(embeddings), successful_ids, total, processed, errors


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
# Entry point.
# ---------------------------------------------------------------------------------------

def main():

    # Arg parser.
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    parser.add_argument("--batch", type=int, default=32,   help="Size of a batch. Defaults to 32.")
    args = parser.parse_args()

    # Setting up logger.
    logger = setup_logging(LOG_DIR)

    # Making sure the output dir exists.
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    embeddings_path = os.path.join(OUTPUT_DIR, "catalog_embeddings.npy")
    ids_path        = os.path.join(OUTPUT_DIR, "catalog_ids.npy")

    # Get all files from input dir.
    files = os.listdir(INPUT_DIR)

    # Filter out non-image files.
    only_images = list(filter(is_image, files))

    # Apply limit.
    if args.limit is not None:
        only_images = only_images[:args.limit]

    # Exit if no images in the folder.
    if len(only_images) == 0:
        logger.info(f"No images found. Exiting.")
        sys.exit()

    # Extract item IDs from filenames (filenames are {item_id}.png).
    item_ids = [os.path.splitext(f)[0] for f in only_images]

    # Full path of every image.
    image_paths = list(map(to_full_path, only_images))

    # Turn on CUDA, Metal, or fall back to CPU.
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info(f"Device: {device}")

    # Load the CLIP model and preprocessor.
    result     = clip.load("ViT-B/32", device=device)
    model      = result[0]
    preprocess = result[1]

    summary = {"total": 0, "processed": 0, "errors": 0}

    embeddings, successful_ids, summary["total"], summary["processed"], summary["errors"] = get_embeddings(
        batch_size = args.batch,
        file_paths = image_paths,
        item_ids   = item_ids,
        device     = device,
        logger     = logger,
        model      = model,
        preprocess = preprocess,
    )

    # If zero images were embedded, raise error and exit.
    if summary["processed"] == 0:
        logger.error("No images were successfully processed. Exiting.")
        sys.exit()

    # Put the embeddings on CPU then convert to numpy.
    embeddings_numpy = embeddings.cpu().numpy()

    # Save embeddings and corresponding item IDs in the same order.
    np.save(embeddings_path, embeddings_numpy)
    np.save(ids_path, np.array(successful_ids))

    logger.info("Script finished.")

    print("\n--- Summary ---")
    print(f"  Total:        {summary['total']}")
    print(f"  Processed:    {summary['processed']}")
    print(f"  Errors:       {summary['errors']}")


if __name__ == "__main__":
    main()