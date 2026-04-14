"""
feature_extraction.py 

Final stage of the pipeline.

    - Gets the folder of the filtered clothing
    - Loads OpenAi's clip model from github
    - Gets an embedding for each file in the folder of filtered clothing
    - Saves it to an npy.
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
LOG_DIR = "../logs/feature_extraction.log"

# ---------------------------------------------------------------------------------------
# Main feature extraction logic
# ---------------------------------------------------------------------------------------

def get_embeddings(batch_size: int, 
                   file_paths: list[str], 
                   device: str, 
                   logger: logging.Logger, 
                   model: clip.model.CLIP, 
                   preprocess: clip.model.Compose) -> torch.Tensor:

    """
    Takes file paths and puts them through preprocess and model in batches. 

    Args:
        num_of_batches: number of batches to compute.
        batch_size: size of the batch.
        files: the image files.
        device: device for running computations. 
        logger: logger
        model: clip.model.CLIP
        preprocess: clip.model.Compose

    Returns tensors for each image in one large tensor.
    """
    # All the embeddings.
    embeddings = []
    total = len(file_paths)
    errors = 0
    processed = 0

    # Compute the number of batches required.
    num_of_batches = (len(file_paths) + (batch_size - 1)) // batch_size

    # Get images in batches and convert them to embeddings using the CLIP model.
    for batch_num in range(num_of_batches):

        logger.info(f"Processing batch number: {batch_num}.\n")

        # A list (batch) of images that have been fed through preprocess().
        batch_of_processed_images = []

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

                # Put the processed image in the list.
                batch_of_processed_images.append(processed_img)
                processed += 1

            # If preprocessing fails
            except Exception:
                logger.error(f"Failed to process image: {i} in batch number: {batch_num}")
                errors += 1
                continue
        
        # If every image in the batch fails, skip to next batch.
        if not batch_of_processed_images:
            logger.warning(f"Batch {batch_num} had no valid images, skipping.")
            continue

        # Put the tensors into one big tensor for CLIP.
        tensor = torch.stack(batch_of_processed_images)

        # Run batch through CLIP model
        with torch.no_grad():
            vector_batch = model.encode_image(tensor)
        
        # Add to embeddings
        embeddings.append(vector_batch)
    total = processed + errors

    return torch.cat(embeddings), total, processed, errors
        
        

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

    # Arg parser
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    parser.add_argument("--batch", type=int, default=32, help="Size of a batch. Defaults to 32.")
    args = parser.parse_args()

    # Setting up logger
    logger = setup_logging(LOG_DIR)

    # Making sure the output dir exists.
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(OUTPUT_DIR, "catalog_embeddings.npy")

    # Get all files from input dir.
    files = os.listdir(INPUT_DIR)

    # Filter out non-image files.
    only_images = list(filter(is_image, files))

    # Path of every image.
    image_paths = list(map(to_full_path, only_images))

    limit = args.limit
    batch = args.batch

    # Exit if no images in the folder.
    if len(image_paths) == 0:
        logger.info(f"No images found. Number of image files in folder: {len(only_images)}")
        logger.info(f"Exiting...\n")
        sys.exit()
    else:
        image_paths = image_paths[:limit]

    # Turn on CUDA, Metal, or fall back to CPU.
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info(f"Device: {device}")

    # Load the CLIP model and preprocessor.
    result     = clip.load("ViT-B/32", device=device)
    model      = result[0]
    preprocess = result[1]


    summary = {"total" : 0, "processed" : 0, "errors" : 0}  

    # The vectors that the images have been transformed into.
    # Each vector is 512 dim.
    embeddings, summary["total"], summary["processed"], summary["errors"] = get_embeddings(batch_size=batch, file_paths=image_paths, device=device, logger=logger,model=model, preprocess=preprocess)
    
    # Put the embeddings on CPU then convert to numpy.
    embeddings_numpy = embeddings.cpu().numpy()

    # Stack all batch embeddings into one array.
    np.save(output_path, embeddings_numpy)

    logger.info("Script finished.")

    print("\n--- Summary ---")
    print(f"  Total:        {summary['total']}")
    print(f"  Processed:    {summary['processed']}")
    print(f"  Errors:       {summary['errors']}")

if __name__ == "__main__":
    main()