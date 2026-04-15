"""
fetch_catalog.py 

First stage of the pipeline.

    - Fetches all items in two columns: "item_id, item_img" from the database.
    - Writes the two columns to a csv file.

"""

import csv
import os
import logging
from supabase import create_client
from pathlib import Path
from dotenv import load_dotenv
from logger import setup_logging
import argparse

if (load_dotenv()):
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY")
else:
    exit(1)

OUTPUT_CSV = "../data/csv/image_urls.csv"
LOG_PATH = "../logs/fetch_catalog.log"

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10, help="Max number of items to fetch. Defaults to 10.")
    return parser.parse_args()

def fetch(logger: logging.Logger, limit: int | None = None) -> list[dict] | None:
    """
    Connects to a supabase table and getches the item_id and item_img columns.
    """
    try:
        # Create the Supabase client.
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        # Query item_id and item_img from the Clothing table.
        query = client.table("Clothing").select("item_id, item_img").order("item_id")

        if limit is not None:
            query = query.limit(limit)
        response = query.execute()

        return response.data

    except Exception as e:
        logger.error(f"Error fetching from db: {e}")
        return None

def write_to_csv(logger: logging.Logger, csv_path: str, rows: list[dict]) -> None:
    """
    Takes a list of dicts and writes them into a csv file with two columns: "item_id, item_img".
    """
    # Opening a csv file.
    with open(csv_path, "w", newline="") as f:

        # Writing to csv file.
        writer = csv.DictWriter(f, fieldnames=["item_id", "item_img"])
        writer.writeheader()
        writer.writerows(rows)

def main():
    args   = parse_args()
    logger = setup_logging(LOG_PATH) 
    
    fetched_items = fetch(logger, args.limit)

    if (fetched_items is None):
        return
    
    logger.info(f"Fetched {len(fetched_items)} items from database.")


    Path(OUTPUT_CSV).parent.mkdir(parents=True, exist_ok=True)

    write_to_csv(logger, OUTPUT_CSV, fetched_items)

    print("\n--- Summary ---")
    print(f"  Fetched:   {len(fetched_items)}")
    print(f"  Written to: {OUTPUT_CSV}\n")

    logger.info("fetch_catalog.py finished.\n")

if __name__ == "__main__": 
    main()
    