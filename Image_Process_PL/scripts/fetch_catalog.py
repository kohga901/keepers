import csv
import os
import logging
import psycopg2
from pathlib import Path
from dotenv import load_dotenv
from logger import setup_logging


if (load_dotenv()):
    DATABASE_URL = os.getenv("DATABASE_URL")
else:
    exit(1)

OUTPUT_CSV = "../data/image_urls.csv"
LOG_PATH = "../logs/fetch_catalog.log"

def fetch(logger: logging.Logger):
    try:
        # Connect to the DB
        conn = psycopg2.connect(DATABASE_URL)

        # Create a cursor to run queries
        cursor = conn.cursor()

        # Run a query
        cursor.execute("SELECT item_id, item_img FROM \"Clothing\";")

        # Fetch all results as a list of tuples
        rows = cursor.fetchall()

        # Close the connection
        cursor.close()
        conn.close()
        
        return rows

    except Exception:
        logger.error(f"Error fetching from db.")
    