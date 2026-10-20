"""
clip_service.py

Lazy-loaded CLIP model used to embed a single clothing image on demand
(e.g. from the Easy Upload page). Mirrors the model setup in
services/Embeddings/embeddings.py, but loads once and exposes a
function instead of running as a batch script.

torch and clip are imported inside the functions, not at module level:
importing them costs ~280 MB, which the 512 MB server can't afford to pay
at boot for a feature that is rarely used.
"""

import logging as log
from io import BytesIO

import numpy as np

# The CLIP model, its image preprocessing function, and the device it runs on.
# All None until the first upload.
_model = None
_preprocess = None
_device = None


def _load_model():
    """Loads CLIP on first use so server boot isn't slowed down by it."""
    global _model, _preprocess, _device
    # Only load the model the first time this is called.
    if _model is None:
        import torch
        import clip

        # Use the Apple GPU if there is one, otherwise the CPU.
        _device = "mps" if torch.backends.mps.is_available() else "cpu"
        log.info(f"Loading CLIP (ViT-B/32) on device={_device}...")

        # Load the model and its preprocessing function.
        _model, _preprocess = clip.load("ViT-B/32", device=_device)
        log.info("CLIP loaded.")
    return _model, _preprocess


def embed_image_url(url: str, timeout: int = 10) -> np.ndarray:
    """
    Downloads an image from `url` and returns its raw (un-normalized) 512-dim
    CLIP embedding as a float32 numpy array. Raises on network/decoding errors.
    """
    import requests
    import torch
    from PIL import Image

    # Get the CLIP model, loading it if this is the first call.
    model, preprocess = _load_model()

    # Download the image. Raise an error if the download failed.
    response = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()

    # Open the image and convert it to RGB.
    img = Image.open(BytesIO(response.content)).convert("RGB")

    # Preprocess the image into the tensor shape CLIP expects.
    tensor = preprocess(img).unsqueeze(0).to(_device)  # type: ignore

    # Run the image through CLIP. No gradients are needed since nothing is being trained.
    with torch.no_grad():
        embedding = model.encode_image(tensor)

    # Return the embedding as a 1D float32 numpy array.
    return embedding.cpu().numpy()[0].astype(np.float32)
