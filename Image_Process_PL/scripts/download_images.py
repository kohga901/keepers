"""
download_images.py.

Given the path of a csv file:
    - fetches the all the urls from the item_img column 
    - download the images
    - save the images in the downloaded_images folder

Usage:
    image_downloader.py --limit 4000
    image_downloader.py
"""

from io import BytesIO
import csv
import requests
import argparse
import os
import sys
import hashlib
from pathlib import Path
from PIL import Image
from logger import setup_logging
import logging

# ---------------------------------------------------------------------------
# Config setup
# ---------------------------------------------------------------------------

CSV_PATH   = "../data/csv/image_urls.csv"   # CSV file containing image URLs
CSV_URL_COLUMN = "item_img"                 # column name in CSV that contains the image URL
OUTPUT_DIR = "../data/downloaded_images"    # output file 
LOG_PATH = "../logs/download_images.log"    # log file

# ---------------------------------------------------------------------------
# ARG PARSER
# ---------------------------------------------------------------------------

def parse_args():
    """
    Parses cmdline args and returns them.
    Passes --limit for number of rows to process.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="Max number of rows to process. Defaults to 100.")
    # parser.add_argument("--batch", type=int, default=10, help="Max number of rows to process at a time. Defaults to 10.")

    return parser.parse_args()


# ---------------------------------------------------------------------------
# Core logic for image download 
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

    # Open the csv file.
    with open(csv_path, newline="") as f:

        # Make a csv reader
        reader = csv.DictReader(f)

        # Go through each row and get the cell from the item_img column.
        for row in reader:
            url = row.get(CSV_URL_COLUMN, "").strip()

            # If its not None, put it in the url list.
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
        # Request image, wait for 10 seconds for timeout.
        response = requests.get(url, timeout=10)

        # Check if it gave any HTTPS error codes.
        response.raise_for_status()

        # Return the image as a PIL object.
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception:
        return None

def process_urls(
    urls: list[str],
    output_dir: Path,
    logger: logging.Logger,
    limit: int
) -> dict:
    
    """
    Downloads images in from a URLS and saves it to output_dir.
    If a download fails, logs the error and returns "error".

    Args:
        urls: Image URLS to download.
        output_dir: Directory to write the downloaded image to.
        logger: Logger instance.
    Returns:
        A summary dictionary of the results.
    """

    # Summary format.
    summary = {"total": 0, "downloaded": 0, "image_download_failed": 0}

    # Try downloading the image to the downloaded_images folder.
    for url in urls[:limit]:

        # Make the filename by hashing the url and make it end with ".png".
        filename = hashlib.md5(url.encode()).hexdigest() + ".png"

        # Make the output path with the filename set.
        out_path = output_dir / filename

        # Get the image from the url.
        image = download_image(url)

        summary["total"] += 1

        # If image failed fetch from url.
        if image is None:
            logger.error(f"[error] Failed to download: {url}")
            summary["image_download_failed"] += 1
            continue

        # Save the image to the output path.
        image.save(out_path, format="PNG")
        logger.info(f"[downloaded] {filename}")
        summary["downloaded"] += 1

    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the download images script.
    Gets rows from csv file, downloads images to the folder with given limit.
    Returns a summary of the process.
    """
    # Make the parser for cli.
    args = parse_args()

    limit = args.limit

    urls = load_urls_from_csv(CSV_PATH)

    logger = setup_logging(LOG_PATH)    

    output_path = Path(OUTPUT_DIR)
    output_path.mkdir(parents=True, exist_ok=True)

    summary = process_urls(urls, output_path, logger, limit)

    logger.info("download_images.py done.")

    print("\n--- Summary ---")
    print(f"  Total processed:                  {summary['total']}")
    print(f"  Downloaded:                       {summary['downloaded']}")
    print(f"  Failed to download removed:       {summary['image_download_failed']}")

if __name__ == "__main__":
    main()