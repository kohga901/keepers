"""
logger.py

Given a directroy to a log_file:
    - Logs to that file.
    - Logs to console.
"""

import logging
import os
import sys


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging(log_file: str, log_level: int = logging.DEBUG) -> logging.Logger:
    """
    Configures and returns a logger that writes to both
    the console and a log file.

    Args:
        log_file: Path to the log file to write to.
        log_level: Log level
            logging.DEBUG = 10
            logging.INFO = 20
            logging.WARNING = 30
            logging.ERROR = 40
            logging.CRITICAL = 50
    Returns:
        Configured logger instance.
    """
    # Getting the logger from logging.
    logger = logging.getLogger(__name__)

    # Setting the log level.
    logger.setLevel(log_level)

    # Getting a handler that handles printing to the console.
    console_handler = logging.StreamHandler(sys.stdout)

    # Checking if the log_file exists.
    os.makedirs(os.path.dirname(log_file), exist_ok=True)

    # Getting a handler that handles printing to a file.
    file_handler = logging.FileHandler(log_file)

    # Making and getting a format.
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    # Adding the formats to the handlers.
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    # Adding the handlers to the logger.
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return logger
