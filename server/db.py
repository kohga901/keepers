import logging
import os
import time
from pathlib import Path

import httpx
from supabase import create_client, Client, ClientOptions
from dotenv import load_dotenv

log = logging.getLogger(__name__)

# Load the environment variables from server/.env.
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# Supabase project URL and API key.
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Supabase caps a single select at 1000 rows, so anything larger has to be paged.
PAGE_SIZE = 1000

# One client shared by every request thread. HTTP/2 is turned off because it
# multiplexes every thread's request over a single connection; with HTTP/1.1
# each concurrent request gets its own pooled connection.
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=ClientOptions(
        httpx_client=httpx.Client(http2=False, timeout=10, follow_redirects=True)
    ),
)


def supabase_execute(query, retries=3, delay=0.5):
    # Try the query up to `retries` times.
    for attempt in range(retries):
        try:
            # Run the query and return its response.
            return query.execute()
        except Exception as e:
            # Log the failure so it shows up in the server logs.
            log.warning("Supabase call failed (attempt %d/%d): %r", attempt + 1, retries, e)

            # Wait a bit and try again, unless this was the last attempt.
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise


def supabase_fetch_all(build_query, page_size=PAGE_SIZE):
    """
    Yields every page of rows for a select that may exceed Supabase's row cap.

    Args:
        build_query: function returning a fresh select query. It must have a
                     stable order, otherwise pages can overlap or skip rows.
    """
    # Row number the next page starts at.
    start = 0
    while True:
        # Fetch one page of rows.
        response = supabase_execute(build_query().range(start, start + page_size - 1))
        yield response.data

        # A page that isn't full is the last one.
        if len(response.data) < page_size:
            break

        # Move on to the next page.
        start += page_size
