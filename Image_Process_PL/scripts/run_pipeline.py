"""
run_pipeline.py

Pipeline Orchestrator

Runs the full clothing image processing pipeline in sequence:
    1. clear_data.py        — clears all intermediate data folders (optional, use --clear)
    2. fetch_catalog.py     — fetches item_id and item_img from DB, writes to CSV
    3. download_images.py   — downloads images from CSV URLs
    4. filter_background.py — removes backgrounds, applies white background
    5. feature_extraction.py — extracts CLIP embeddings, saves to .npy
Usage:
    python run_pipeline.py
    python run_pipeline.py --limit 50
    python run_pipeline.py --limit 50 --clear

Dependencies:
    All dependencies from fetch_catalog.py, download_images.py, filter_background.py, feature_extraction.py
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
    Passes --clear to optionally clear data folders before running.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    parser.add_argument("--clear", action="store_true", help="Clear all data folders before running the pipeline.")
    parser.add_argument("--batch", type=int, default=32, help="Batch size for feature extraction. Defaults to 32.")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# PIPELINE STAGES
# ---------------------------------------------------------------------------

def run_clear_data(logger: logging.Logger) -> bool:
    """
    Runs clear_data.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """
    logger.info("Running clear_data.py.")
    result = subprocess.run(["python", "clear_data.py"])
    return result.returncode == 0


def run_fetch_catalog(limit: int, logger: logging.Logger) -> bool:
    """
    Runs fetch_catalog.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        limit: Max number of items to fetch from db. None means all.
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """
    if limit is not None:
        logger.info(f"Running fetch_catalog.py. Argument: {limit}.")
        result = subprocess.run(["python", "fetch_catalog.py", "--limit", str(limit)])
    else:
        logger.info(f"Running fetch_catalog.py. Argument: None.")
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
    if limit is not None:
        logger.info(f"Running download_images.py. Argument: {limit}.")
        result = subprocess.run(["python", "download_images.py", "--limit", str(limit)])
    else:
        logger.info(f"Running download_images.py. Argument: None.")
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
    if limit is not None:
        logger.info(f"Running filter_background.py. Argument: {limit}.")
        result = subprocess.run(["python", "filter_background.py", "--limit", str(limit)])
    else:
        logger.info(f"Running filter_background.py. Argument: None.")
        result = subprocess.run(["python", "filter_background.py"])

    return result.returncode == 0


def run_feature_extraction(limit: int, batch: int, logger: logging.Logger) -> bool:
    """
    Runs feature_extraction.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        limit: Max number of images to process. None means all.
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """
    cmd = ["python", "feature_extraction.py", "--batch", str(batch)]

    if limit is not None:
        
        cmd += ["--limit", str(limit)]

    logger.info(f"Running feature_extraction.py. Limit: {limit}, Batch: {batch}.")
    result = subprocess.run(cmd)
    return result.returncode == 0

def run_upload_embeddings(logger: logging.Logger) -> bool:
    """
    Runs upload_embeddings.py as a subprocess.
    Returns True if successful, False if it failed.

    Args:
        logger: Logger instance.
    Returns:
        True if script exited successfully, False otherwise.
    """
    logger.info("Running upload_embeddings.py.")
    result = subprocess.run(["python", "upload_embeddings.py"])
    return result.returncode == 0

# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the pipeline orchestrator.
    Runs all pipeline stages in sequence.
    If any stage fails, logs the error and stops the pipeline.
    """
    args   = parse_args()
    logger = setup_logging(LOG_FILE)
    logger.info("--------------------------------------------------------------------------------------------------------\n")
    logger.info("Starting run_pipeline orchestrator.\n")

    if args.clear:
        if not run_clear_data(logger):
            logger.error("Error at run_clear_data.")
            return

    if not run_fetch_catalog(args.limit, logger):
        logger.error("Error at run_fetch_catalog.")
        return

    if not run_download_images(args.limit, logger):
        logger.error("Error at run_download_images.")
        return

    if not run_filter_background(args.limit, logger):
        logger.error("Error at run_filter_background.")
        return

    if not run_feature_extraction(args.limit, args.batch, logger):
        logger.error("Error at run_feature_extraction.")
        return
    
    # if not run_upload_embeddings(logger):
    #     logger.error("Error at run_upload_embeddings.")
    #     return

    logger.info("Pipeline completed successfully.\n")
    logger.info("--------------------------------------------------------------------------------------------------------\n")


if __name__ == "__main__":
    main()