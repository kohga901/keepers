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

import os
import logging
from pathlib import Path
from PIL import Image
from rembg import remove, new_session


# ---------------------------------------------------------------------------
# Config setup
# ---------------------------------------------------------------------------

INPUT_DIR = "data/stage1"        # output folder from filter_people.py
OUTPUT_DIR = "data/stage2"       # cleaned images passed to clip_extraction.py
LOG_FILE = "logs/filter_background.log"

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
    pass


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
    pass


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
    pass


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
    pass


# ---------------------------------------------------------------------------
# Per-image processing
# ---------------------------------------------------------------------------

def process_image(
    image_path: Path,
    session,
    output_dir: Path,
    logger: logging.Logger,
) -> None:
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
    pass


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------

def process_folder(
    input_dir: str,
    output_dir: str,
    logger: logging.Logger,
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
    pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the filter_background pipeline stage.
    Sets up logging, loads the rembg session, runs batch processing,
    and prints a final summary report to the console.
    """
    pass


if __name__ == "__main__":
    main()