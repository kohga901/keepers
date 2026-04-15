"""
upload_embeddings.py

Uploads embeddings and their corresponding item IDs to the Supabase embeddings table.

Usage:
    python upload_embeddings.py
"""

import os
import logging
import numpy as np
from supabase import create_client
from dotenv import load_dotenv
from logger import setup_logging

if load_dotenv():
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY")
else:
    exit(1)

EMBEDDINGS_PATH = "../data/embedded_vectors/catalog_embeddings.npy"
IDS_PATH        = "../data/embedded_vectors/catalog_ids.npy"
LOG_PATH        = "../logs/upload_embeddings.log"


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def load_embeddings(embeddings_path: str, ids_path: str, logger: logging.Logger):
    """
    Loads embeddings and item IDs from .npy files.

    Args:
        embeddings_path: Path to catalog_embeddings.npy
        ids_path: Path to catalog_ids.npy
        logger: Logger instance.
    Returns:
        Tuple of (embeddings numpy array, item_ids numpy array) or (None, None) on failure.
    """
    try:
        embeddings = np.load(embeddings_path)
        item_ids   = np.load(ids_path)
        logger.info(f"Loaded {len(embeddings)} embeddings and {len(item_ids)} IDs.")
        return embeddings, item_ids

    except Exception as e:
        logger.error(f"Failed to load .npy files: {e}")
        return None, None


def upload(
    embeddings: np.ndarray,
    item_ids: np.ndarray,
    logger: logging.Logger,
) -> dict:
    """
    Uploads embeddings and their corresponding item IDs to the Supabase embeddings table.

    Args:
        embeddings: Numpy array of shape (n, 512).
        item_ids: Numpy array of item ID strings.
        logger: Logger instance.
    Returns:
        Summary dictionary of results.
    """
    summary = {"total": 0, "uploaded": 0, "errors": 0}

    try:
        # Create the Supabase client.
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        # Upload each embedding with its corresponding item ID.
        for i in range(len(embeddings)):
            summary["total"] += 1
            try:
                client.table("Embeddings").upsert({
                    "item_id":   int(item_ids[i]),
                    "embedding": embeddings[i].tolist(),
                }).execute()

                logger.info(f"[uploaded] item_id: {item_ids[i]}")
                summary["uploaded"] += 1

            except Exception as e:
                logger.error(f"[error] item_id: {item_ids[i]} — {e}")
                summary["errors"] += 1

    except Exception as e:
        logger.error(f"Failed to create Supabase client: {e}")

    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    logger = setup_logging(LOG_PATH)

    embeddings, item_ids = load_embeddings(EMBEDDINGS_PATH, IDS_PATH, logger)

    if embeddings is None or item_ids is None:
        logger.error("Failed to load embeddings. Exiting.")
        return

    if len(embeddings) != len(item_ids):
        logger.error(f"Mismatch — {len(embeddings)} embeddings but {len(item_ids)} IDs. Exiting.")
        return

    summary = upload(embeddings, item_ids, logger)

    logger.info("Script finished.")
    print("\n--- Summary ---")
    print(f"  Total:    {summary['total']}")
    print(f"  Uploaded: {summary['uploaded']}")
    print(f"  Errors:   {summary['errors']}")


if __name__ == "__main__":
    main()