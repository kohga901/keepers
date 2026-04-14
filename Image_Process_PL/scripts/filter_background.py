"""
filter_background.py

Pipeline Stage 2: Background Removal & White Background Application

Processes the output folder from filter_people.py. For each image:
  - Removes the background using rembg
  - Replaces the transparent background with solid white
  - Outputs the final cleaned image to a staging folder for clip_extraction.py

Dependencies:
    pip install rembg pillow
"""

import argparse
import os
import sys
import logging
from pathlib import Path
from PIL import Image
from rembg import remove, new_session


# ---------------------------------------------------------------------------
# Config setup
# ---------------------------------------------------------------------------

INPUT_DIR = "../data/people_filtered"   # output folder from filter_people.py 
OUTPUT_DIR = "../data/background_filtered" # cleaned images passed to clip_extraction.py

LOG_FILE = "../logs/filter_background.log"

BACKGROUND_COLOR = (255, 255, 255)  # white
OUTPUT_FORMAT = "PNG"               # PNG preserves quality, no compression artifacts


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging(log_file: str) -> logging.Logger:
    """
    Configures and returns a logger that writes to both
    the console and a log file.

    Args:
        log_file: Path to the log file to write to.
    Returns:
        Configured logger instance.
    """
    # Getting the logger from logging.
    logger = logging.getLogger(__name__)

    # Setting the log level.
    logger.setLevel(logging.DEBUG)

    # Getting a handler that handles printing to the console.
    console_handler = logging.StreamHandler(sys.stdout)

    # Checking if the log_file exists.
    os.makedirs(os.path.dirname(log_file), exist_ok=True)

    # Getting a handler that handles printing to a file.
    file_handler = logging.FileHandler(log_file)

    # Making and getting a format.
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    # Adding the formats to the handlers.
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    # Adding the handlers to the logger.
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return logger


# ---------------------------------------------------------------------------
# Load model
# ---------------------------------------------------------------------------

def load_rembg_session():
    """
    Initializes and returns a rembg session using the u2net model.
    Creating a session once and reusing it across images is significantly
    faster than initializing a new session per image.

    Returns:
        A rembg session object to be passed into remove_background().
    """
    return new_session("u2net")


# ---------------------------------------------------------------------------
# Core background removal logic
# ---------------------------------------------------------------------------

def remove_background(image: Image.Image, session) -> Image.Image:
    """
    Runs rembg on a single image to remove its background,
    returning a PIL Image in RGBA mode with a transparent background.

    Args:
        image: PIL Image to process (any mode).
        session: Rembg session object from load_rembg_session().
    Returns:
        PIL Image in RGBA mode with background removed (transparent).
    """
    return remove(image, session=session)


def apply_white_background(image_rgba: Image.Image) -> Image.Image:
    """
    Composites an RGBA image onto a solid white background,
    returning a clean RGB image with no transparency.

    This ensures consistent white backgrounds across all output
    images regardless of the original background content.

    Args:
        image_rgba: PIL Image in RGBA mode (transparent background).
    Returns:
        PIL Image in RGB mode with a solid white background.
    """
    # Get a white image with the given image's size.
    white_bg = Image.new("RGB", image_rgba.size, BACKGROUND_COLOR)

    # 
    white_bg.paste(image_rgba, mask=image_rgba.split()[3])
    return white_bg


# ---------------------------------------------------------------------------
# Per-image processing
# ---------------------------------------------------------------------------

def process_image(
    image_path: Path,
    session,
    output_dir: Path,
    logger: logging.Logger,
) -> str:
    """
    Processes a single image through the full background-filter logic:
      1. Load image from disk.
      2. Remove background via rembg → RGBA image with transparency.
      3. Composite onto solid white background → clean RGB image.
      4. Save result to output_dir as PNG.
      5. If any step fails → log the error and save the original image
         as-is so no products are lost downstream.

    Args:
        image_path: Path to the input image from stage1.
        session: Rembg session object.
        output_dir: Directory to write the processed image to.
        logger: Logger instance for status and error messages.
    """
    out_path = output_dir / (image_path.stem + ".png")
    try:
        image = Image.open(image_path).convert("RGB")

        image_rgba = remove_background(image, session)
        result = apply_white_background(image_rgba)
        result.save(out_path, format=OUTPUT_FORMAT)
        logger.info(f"[background_removed]    {image_path.name}")
        return "background_removed"

    except Exception as e:
        logger.error(f"[failed_passed_through] {image_path.name} — {e}")
        try:
            image = Image.open(image_path).convert("RGB")
            image.save(out_path, format=OUTPUT_FORMAT)
        except Exception as save_err:
            logger.error(f"[error]                 {image_path.name} — could not save original: {save_err}")
            return "error"
        return "failed_passed_through"


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------

def process_folder(
    input_dir: str,
    output_dir: str,
    logger: logging.Logger,
    session,
    limit: int = None,
) -> dict:
    """
    Iterates over all images in input_dir, runs process_image() on each,
    and writes results to output_dir.

    Returns a summary dict with counts:
        {
            "total": int,
            "background_removed": int,
            "failed_passed_through": int,
            "errors": int,
        }

    Args:
        input_dir: Path to the folder of stage1 images.
        output_dir: Path to the folder where processed images are saved.
        logger: Logger instance.
    Returns:
        Summary dictionary of processing results.
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    os.makedirs(output_path, exist_ok=True)

    image_files = [
        f for f in input_path.iterdir()
        if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    ]

    if limit is not None:
        image_files = image_files[:limit]

    logger.info(f"Found {len(image_files)} image(s) to process.")

    summary = {"total": 0, "background_removed": 0, "failed_passed_through": 0, "errors": 0}

    for image_path in image_files:
        summary["total"] += 1
        status = process_image(image_path, session, output_path, logger)
        if status in summary:
            summary[status] += 1

    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the filter_background pipeline stage.
    Sets up logging, loads the rembg session, runs batch processing,
    and prints a final summary report to the console.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    args = parser.parse_args()

    logger = setup_logging("../logs/filter_background.log")
    logger.info("Starting background removal process.")

    session = load_rembg_session()
    summary = process_folder(INPUT_DIR, OUTPUT_DIR, logger, session, args.limit)

    logger.info("Done.")
    print("\n--- Summary ---")
    print(f"  Total processed:        {summary['total']}")
    print(f"  Background removed:     {summary['background_removed']}")
    print(f"  Failed (passed through): {summary['failed_passed_through']}")
    print(f"  Errors:                 {summary['errors']}")


if __name__ == "__main__":
    main()
