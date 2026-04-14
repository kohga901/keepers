import csv
import os
import logging
import psycopg2
from pathlib import Path
from dotenv import load_dotenv
from logger import setup_logging

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
OUTPUT_CSV = "../data/image_urls.csv"
LOG_PATH = "../logs/fetch_catalog.log"

client = create_client(SUPABASE_URL, SUPABASE_KEY)
response = client.table("Clothing").select("item_id, item_img").execute()