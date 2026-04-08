"""
filter_people.py

Pipeline Stage 1: Image Downloader (Person Detection Temporarily Disabled)

Processes a CSV of image URLs. For each URL:
  - Downloads the image into memory
  - Saves it to the output folder for filter_background.py

  NOTE: Person detection and clothing segmentation are currently disabled.
  The script acts as a pure downloader. Detection/segmentation can be
  re-enabled later by uncommenting the relevant sections.

Dependencies:
    pip install pillow requests
"""
import argparse
import csv
import hashlib
import os
import sys
import logging
# import numpy as np
from pathlib import Path
from PIL import Image
# from ultralytics import YOLO
import requests
from io import BytesIO


# ---------------------------------------------------------------------------
# CONFIG SETUP
# ---------------------------------------------------------------------------

CSV_PATH   = "../data/csv/image_urls.csv"   # CSV file containing image URLs
OUTPUT_DIR = "../data/people_filtered"       # output folder passed to filter_background.py
LOG_FILE   = "../logs/filter_people.log"

CSV_URL_COLUMN = "item_img"                 # column name in CSV that contains the image URL

# PERSON_CONFIDENCE_THRESHOLD = 0.5         # min confidence to consider a person detected
# SEG_CONFIDENCE_THRESHOLD    = 0.4         # min confidence for clothing segmentation mask


# ---------------------------------------------------------------------------
# ARG PARSER
# ---------------------------------------------------------------------------

def parse_args():
    """
    Parses the cmdline input and checks how many images to process.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# LOGGING SETUP
# ---------------------------------------------------------------------------

def setup_logging(log_file: str) -> logging.Logger:
    """
    Configures and returns a logger that writes to both
    the console and a log file.
    """
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.DEBUG)

    # Log onto console
    console_handler = logging.StreamHandler(sys.stdout)

    # Log into the log file
    os.makedirs(os.path.dirname(log_file), exist_ok=True)
    file_handler = logging.FileHandler(log_file)

    # Setting the format to time - log level - message
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return logger


# ---------------------------------------------------------------------------
# MODEL LOADING (DISABLED)
# ---------------------------------------------------------------------------

# def load_detection_model(model_path: str = "yolov8n.pt") -> YOLO:
#     """
#     Loads and returns the YOLOv8 detection model used to
#     identify whether a person is present in an image.
#     """
#     model = YOLO(model_path)
#     return model


# def load_segmentation_model(model_path: str = "yolov8n-seg.pt") -> YOLO:
#     """
#     Loads and returns the YOLOv8 segmentation model used to
#     isolate the clothing region from images that contain a person.
#     """
#     model = YOLO(model_path)
#     return model


# ---------------------------------------------------------------------------
# CORE LOGIC
# ---------------------------------------------------------------------------

def load_urls_from_csv(csv_path: str) -> list[str]:
    """
    Reads image URLs from a CSV file and returns them as a list of strings.

    Args:
        csv_path: Path to the CSV file containing image URLs.
    Returns:
        List of image URL strings.
    """
    urls = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = row.get(CSV_URL_COLUMN, "").strip()
            if url:
                urls.append(url)
    return urls


def download_image(url: str) -> Image.Image | None:
    """
    Downloads an image from a URL and returns it as a PIL Image.
    Returns None if the download fails for any reason.

    Args:
        url: URL string pointing to an image.
    Returns:
        PIL Image in RGB mode, or None if download failed.
    """
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception:
        return None


# def person_detected(image: Image.Image, model: YOLO) -> bool:
#     """
#     Runs YOLOv8 detection on a single image and returns True
#     if a person is detected above the confidence threshold.
#     """
#     results = model(image)
#     classes           = results[0].boxes.cls
#     confidence_values = results[0].boxes.conf
#     for i in range(len(classes)):
#         if classes[i] == 0.0:
#             if confidence_values[i] > PERSON_CONFIDENCE_THRESHOLD:
#                 return True
#     return False


# def segment_clothing(image: Image.Image, model: YOLO) -> Image.Image | None:
#     """
#     Attempts to isolate the clothing from an image that contains a person.
#     Uses YOLOv8-seg to generate a segmentation mask over the person,
#     inverts it, and returns the image with the person region made transparent.
#     """
#     results = model(image)
#     if results[0].masks is None:
#         return None
#     masks       = results[0].masks.data
#     classes     = results[0].boxes.cls
#     confidences = results[0].boxes.conf
#     person_mask = None
#     for i in range(len(classes)):
#         if classes[i] == 0.0 and confidences[i] >= SEG_CONFIDENCE_THRESHOLD:
#             person_mask = masks[i].cpu().numpy()
#             break
#     if person_mask is None:
#         return None
#     w, h     = image.size
#     mask_img = Image.fromarray((person_mask * 255).astype(np.uint8)).resize((w, h), Image.NEAREST)
#     inverted_mask = 255 - np.array(mask_img)
#     image_rgba = image.convert("RGBA")
#     img_array  = np.array(image_rgba)
#     img_array[:, :, 3] = inverted_mask
#     return Image.fromarray(img_array)


# ---------------------------------------------------------------------------
# PER-URL PROCESSING
# ---------------------------------------------------------------------------

def process_url(
    url: str,
    output_dir: Path,
    logger: logging.Logger,
) -> str:
    """
    Downloads a single image from a URL and saves it to output_dir.
    If the download fails, logs the error and returns "error".

    Args:
        url: Image URL to download.
        output_dir: Directory to write the downloaded image to.
        logger: Logger instance.
    Returns:
        Status string: "downloaded" or "error".
    """
    try:
        filename = hashlib.md5(url.encode()).hexdigest() + ".png"
        out_path = output_dir / filename

        image = download_image(url)
        if image is None:
            logger.error(f"[error]      Failed to download: {url}")
            return "error"

        image.save(out_path, format="PNG")
        logger.info(f"[downloaded] {filename}")
        return "downloaded"

    except Exception as e:
        logger.error(f"[error]      {url} — {e}")
        return "error"


# ---------------------------------------------------------------------------
# BATCH PROCESSING
# ---------------------------------------------------------------------------

def process_urls(
    csv_path: str,
    output_dir: str,
    logger: logging.Logger,
    limit: int = None,
) -> dict:
    """
    Reads image URLs from a CSV file, runs process_url() on each,
    and writes results to output_dir.

    Returns a summary dict with counts:
        {
            "total": int,
            "downloaded": int,
            "errors": int,
        }

    Args:
        csv_path: Path to the CSV file containing image URLs.
        output_dir: Path to the folder where downloaded images are saved.
        logger: Logger instance.
        limit: Max number of URLs to process. Defaults to all.
    Returns:
        Summary dictionary of processing results.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    urls = load_urls_from_csv(csv_path)

    if limit is not None:
        urls = urls[:limit]

    logger.info(f"Found {len(urls)} URL(s) to process.")

    summary = {"total": 0, "downloaded": 0, "errors": 0}

    for url in urls:
        summary["total"] += 1
        status = process_url(url, output_path, logger)
        if status == "downloaded":
            summary["downloaded"] += 1
        else:
            summary["errors"] += 1

    return summary


# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the filter_people pipeline stage.
    Sets up logging, runs batch download, and prints a final summary.
    """
    args   = parse_args()
    logger = setup_logging(LOG_FILE)
    logger.info("Starting image download process.")

    summary = process_urls(
        csv_path   = CSV_PATH,
        output_dir = OUTPUT_DIR,
        logger     = logger,
        limit      = args.limit,
    )

    logger.info("Done.")
    print("\n--- Summary ---")
    print(f"  Total processed: {summary['total']}")
    print(f"  Downloaded:      {summary['downloaded']}")
    print(f"  Errors:          {summary['errors']}")


if __name__ == "__main__":
    main()