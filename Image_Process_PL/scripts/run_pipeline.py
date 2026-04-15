"""
run_pipeline.py

Pipeline Orchestrator

Runs the full clothing image processing pipeline in sequence:
    1. fetch_catalog.py     — fetches item_id and item_img from DB, writes to CSV
    2. download_images.py   — downloads images from CSV URLs
    3. filter_background.py — removes backgrounds, applies white background
    4. feature_extraction.py — extracts CLIP embeddings, saves to .npy
Usage:
    python run_pipeline.py
    python run_pipeline.py --limit 50

Dependencies:
    All dependencies from filter_people.py, filter_background.py, feature_extraction.py
"""
import argparse
import logging
import os
import subprocess
from logger import setup_logging


# ---------------------------------------------------------------------------
# CONFIG SETUP
# ---------------------------------------------------------------------------

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))    # directory where pipeline scripts live
LOG_FILE    = "../logs/run_pipeline.log"


# ---------------------------------------------------------------------------
# ARG PARSER
# ---------------------------------------------------------------------------

def parse_args():
    """
    Parses cmdline args and returns them.
    Passes --limit through to each pipeline script.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    return parser.parse_args()

# ---------------------------------------------------------------------------
# PIPELINE STAGES
# ---------------------------------------------------------------------------
def run_fetch_catalog(limit: int, logger: logging.Logger) -> bool:
    """
    Runs fetch_catalog.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        limit: Max number of images to fetch from db. None means 10.
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """

    # If the there is a limit specified
    if limit is not None:
        logger.info(f"Running fetch_catalog.py. Argument: {limit}.\n")
        result = subprocess.run(["python", "fetch_catalog.py", "--limit", str(limit)])
    else:
        logger.info(f"Running fetch_catalog.py. Argument: None.\n")
        result = subprocess.run(["python", "fetch_catalog.py"])

    return result.returncode == 0

def run_download_images(limit: int, logger: logging.Logger) -> bool:
    """
    Runs download_images.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        limit: Max number of images to process. None means all.
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """

    # If the there is a limit specified
    if limit is not None:
        logger.info(f"Running download_images.py. Argument: {limit}.\n")
        result = subprocess.run(["python", "download_images.py", "--limit", str(limit)])
    else:
        logger.info(f"Running download_images.py. Argument: None.\n")
        result = subprocess.run(["python", "download_images.py"])

    return result.returncode == 0

def run_filter_background(limit: int, logger: logging.Logger) -> bool:
    """
    Runs filter_background.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        limit: Max number of images to process. None means all.
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """
    
    # If the there is a limit specified
    if limit is not None:
        logger.info(f"Running filter_background.py. Argument: {limit}.\n")
        result = subprocess.run(["python", "filter_background.py", "--limit", str(limit)])
    else:
        logger.info(f"Running filter_background.py. Argument: None.\n")
        result = subprocess.run(["python", "filter_background.py"])

    return result.returncode == 0


def run_feature_extraction(limit: int, logger: logging.Logger) -> bool:
    """
    Runs feature_extraction.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        limit: Max number of images to process. None means all.
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """
        
    # If the there is a limit specified
    if limit is not None:
        logger.info(f"Running feature_extraction.py. Argument: {limit}.\n")
        result = subprocess.run(["python", "feature_extraction.py", "--limit", str(limit)])
    else:
        logger.info(f"Running feature_extraction.py. Argument: None.\n")
        result = subprocess.run(["python", "feature_extraction.py"])


    return result.returncode == 0


# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the pipeline orchestrator.
    Runs all three pipeline stages in sequence.
    If any stage fails, logs the error and stops the pipeline.
    """
    args   = parse_args()
    logger = setup_logging(LOG_FILE)
    logger.info("Starting run_pipeline orchestrator.")

    if not run_fetch_catalog(args.limit, logger):
        logger.error(f"Error at run_fetch_catalog.")
        return

    if not run_download_images(args.limit, logger):
        logger.error(f"Error at run_download_images.")
        return

    if not run_filter_background(args.limit, logger):
        logger.error(f"Error at run_filter_background.")
        return
    
    if not run_feature_extraction(args.limit, logger):
        logger.error(f"Error at run_feature_extraction.")
        return
    logger.info("Pipeline completed successfully.")


if __name__ == "__main__":
    main()