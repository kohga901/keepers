"""
filter_people.py

Pipeline Stage 1: Person Detection & Clothing Segmentation

Processes a folder of raw clothing images. For each image:
  - Detects whether a person is present using YOLOv8
  - If a person is found, segments and isolates the clothing using YOLOv8-seg
  - If segmentation fails, passes the original image through (no products dropped)
  - Outputs cleaned images to a staging folder for filter_background.py

Dependencies:
    pip install ultralytics pillow
"""
import argparse
import os
import sys
import logging
import numpy as np
from pathlib import Path
from PIL import Image
from ultralytics import YOLO


# ---------------------------------------------------------------------------
# Config setup
# ---------------------------------------------------------------------------

INPUT_DIR = "../data/raw_images"           # folder of scraped raw images
OUTPUT_DIR = "../data/people_filtered"       # cleaned images passed to filter_background.py
LOG_FILE = "../logs/filter_people.log"

PERSON_CONFIDENCE_THRESHOLD = 0.5   # min confidence to consider a person detected
SEG_CONFIDENCE_THRESHOLD = 0.4      # min confidence for clothing segmentation mask

# ---------------------------------------------------------------------------
# Arg parser
# ---------------------------------------------------------------------------

def parse_args():
    """
    Parses the cmdline input and checks how many images 
    to process.
    """


    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Max number of images to process. Defaults to all.")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Setup models and logging
# ---------------------------------------------------------------------------

def setup_logging(log_file: str) -> logging.Logger:
    """
    Configures and returns a logger that writes to both
    the console and a log file.
    """


    # Setup logger and set its level
    logger = logging.getLogger(__name__)    # Getting logger.
    logger.setLevel(logging.DEBUG)          # Setting log level.

    # Log onto console
    console_handler = logging.StreamHandler(sys.stdout)         # Making the handler for logging to the cmdline.

    # Log into the log file.
    os.makedirs(os.path.dirname(log_file), exist_ok=True)       # Checking if the log file directory exists.
    file_handler = logging.FileHandler(log_file)                # Making the file handler for logging into a file.

    # Setting the format to time - log level - message
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")      

    # Adding the format to the handlers.
    console_handler.setFormatter(formatter) 
    file_handler.setFormatter(formatter)

    # Adding the handlers to the logger.
    logger.addHandler(console_handler)     
    logger.addHandler(file_handler)         


    return logger
    

def load_detection_model(model_path: str = "yolov8n.pt") -> YOLO:
    """
    Loads and returns the YOLOv8 detection model used to
    identify whether a person is present in an image.

    Args:
        model_path: path or name of the YOLOv8 detection model weights.
                    Defaults to the nano model (lightest/fastest).
    Returns:
        Loaded YOLO detection model.
    """
    

    model = YOLO(model_path)
    return model


def load_segmentation_model(model_path: str = "yolov8n-seg.pt") -> YOLO:
    """
    Loads and returns the YOLOv8 segmentation model used to
    isolate the clothing region from images that contain a person.

    Args:
        model_path: path or name of the YOLOv8 segmentation model weights.
                    Defaults to the nano segmentation model.
    Returns:
        Loaded YOLO segmentation model.
    """


    model = YOLO(model_path)
    return model    


# ---------------------------------------------------------------------------
# Core detection & segmentation logic
# ---------------------------------------------------------------------------

def person_detected(image: Image.Image, model: YOLO) -> bool:
    """
    Runs YOLOv8 detection on a single image and returns True
    if a person is detected above the confidence threshold.

    Args:
        image: PIL Image to check.
        model: Loaded YOLOv8 detection model.
    Returns:
        True if a person is detected, False otherwise.
    """
    
    # Running the image through the model.
    results = model(image)

    # Now check if there is a person in the results.
    classes = results[0].boxes.cls
    confidence_values = results[0].boxes.conf

    # Go through the results and check for person class and its conf value.
    for i in range(len(classes)):

        # If there is a person class
        if (classes[i] == 0.0):
            if confidence_values[i] > PERSON_CONFIDENCE_THRESHOLD:
                return True
    
    # If reached here, no person was detected in the image.
    return False
            


def segment_clothing(image: Image.Image, model: YOLO) -> Image.Image | None:
    """
    Attempts to isolate the clothing from an image that contains a person.
    Uses YOLOv8-seg to generate a segmentation mask over the clothing region,
    then crops and returns only the clothing portion of the image.

    Args:
        image: PIL Image containing a person wearing clothing.
        model: Loaded YOLOv8 segmentation model.
    Returns:
        PIL Image of the isolated clothing, or None if segmentation fails
        (e.g. no clothing class detected above confidence threshold).
    """
    results = model(image)

    if results[0].masks is None:
        return None

    masks = results[0].masks.data
    classes = results[0].boxes.cls
    confidences = results[0].boxes.conf

    # Find the first person mask above the confidence threshold
    person_mask = None
    for i in range(len(classes)):
        if classes[i] == 0.0 and confidences[i] >= SEG_CONFIDENCE_THRESHOLD:
            person_mask = masks[i].cpu().numpy()
            break

    if person_mask is None:
        return None

    # Resize mask to match image dimensions
    w, h = image.size
    mask_img = Image.fromarray((person_mask * 255).astype(np.uint8)).resize((w, h), Image.NEAREST)
    inverted_mask = 255 - np.array(mask_img)

    # Apply inverted mask as alpha: person region becomes transparent
    image_rgba = image.convert("RGBA")
    img_array = np.array(image_rgba)
    img_array[:, :, 3] = inverted_mask

    return Image.fromarray(img_array)


# ---------------------------------------------------------------------------
# Per-image processing
# ---------------------------------------------------------------------------

def process_image(
    image_path: Path,
    detection_model: YOLO,
    segmentation_model: YOLO,
    output_dir: Path,
    logger: logging.Logger,
) -> None:
    """
    Processes a single image through the full person-filter logic:
      1. Check if a person is present.
      2. If no person → copy image as-is to output_dir.
      3. If person found → attempt clothing segmentation.
         - Segmentation success → save segmented image to output_dir.
         - Segmentation failure → log warning, save original to output_dir.

    Args:
        image_path: Path to the raw input image.
        detection_model: Loaded YOLOv8 detection model.
        segmentation_model: Loaded YOLOv8 segmentation model.
        output_dir: Directory to write the processed image to.
        logger: Logger instance for status and warning messages.
    Returns:
        Status string: "no_person", "segmented", "segmentation_failed", or "error".
    """
    try:
        image = Image.open(image_path).convert("RGB")
        out_path = output_dir / image_path.name

        if not person_detected(image, detection_model):
            image.save(out_path)
            logger.info(f"[no_person]          {image_path.name}")
            return "no_person"

        segmented = segment_clothing(image, segmentation_model)
        if segmented is not None:
            segmented.save(out_path)
            logger.info(f"[segmented]          {image_path.name}")
            return "segmented"

        # Segmentation failed — pass original through so nothing is dropped
        image.save(out_path)
        logger.warning(f"[segmentation_failed] {image_path.name} — saved original")
        return "segmentation_failed"

    except Exception as e:
        logger.error(f"[error]              {image_path.name} — {e}")
        return "error"


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------

def process_folder(
    input_dir: str,
    output_dir: str,
    logger: logging.Logger,
    detection_model: YOLO,
    segmentation_model: YOLO,
    limit: int = None,
) -> dict:
    """
    Iterates over all images in input_dir, runs process_image() on each,
    and writes results to output_dir.

    Returns a summary dict with counts:
        {
            "total": int,
            "no_person": int,
            "segmented": int,
            "segmentation_failed": int,
            "errors": int,
        }

    Args:
        input_dir: Path to the folder of raw input images.
        output_dir: Path to the folder where processed images are saved.
        logger: Logger instance.
    Returns:
        Summary dictionary of processing results.
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    image_files = [
        f for f in input_path.iterdir()
        if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    ]

    if limit is not None:
        image_files = image_files[:limit]

    logger.info(f"Found {len(image_files)} image(s) to process.")

    summary = {"total": 0, "no_person": 0, "segmented": 0, "segmentation_failed": 0, "errors": 0}

    for image_path in image_files:
        summary["total"] += 1
        status = process_image(image_path, detection_model, segmentation_model, output_path, logger)
        if status == "no_person":
            summary["no_person"] += 1
        elif status == "segmented":
            summary["segmented"] += 1
        elif status == "segmentation_failed":
            summary["segmentation_failed"] += 1
        else:
            summary["errors"] += 1

    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """
    Entry point for the filter_people pipeline stage.
    Sets up logging, loads models, runs batch processing,
    and prints a final summary report to the console.
    """


    args = parse_args()
    logger = setup_logging("../logs/filter_people.log")
    logger.info("Starting person filtering process.")

    detection_model = load_detection_model()
    segmentation_model = load_segmentation_model()
    summary = process_folder(INPUT_DIR, OUTPUT_DIR, logger, detection_model, segmentation_model, args.limit)

    logger.info("Done.")
    print("\n--- Summary ---")
    print(f"  Total processed:      {summary['total']}")
    print(f"  No person (kept as-is): {summary['no_person']}")
    print(f"  Segmented:            {summary['segmented']}")
    print(f"  Segmentation failed:  {summary['segmentation_failed']}")
    print(f"  Errors:               {summary['errors']}")


if __name__ == "__main__":
    main()