"""
clip_service.py

Lazy-loaded CLIP model used to embed a single clothing image on demand
(e.g. from the Easy Upload page). Mirrors the model setup in
services/Embeddings/embeddings.py, but loads once and exposes a
function instead of running as a batch script.
"""

import logging as log
from io import BytesIO

import numpy as np
import requests
import torch
import clip
from PIL import Image

device = "mps" if torch.backends.mps.is_available() else "cpu"

_model = None
_preprocess = None


def _load_model():
    """Loads CLIP on first use so server boot isn't slowed down by it."""
    global _model, _preprocess
    if _model is None:
        log.info(f"Loading CLIP (ViT-B/32) on device={device}...")
        _model, _preprocess = clip.load("ViT-B/32", device=device)
        log.info("CLIP loaded.")
    return _model, _preprocess


def embed_image_url(url: str, timeout: int = 10) -> np.ndarray:
    """
    Downloads an image from `url` and returns its raw (un-normalized) 512-dim
    CLIP embedding as a float32 numpy array. Raises on network/decoding errors.
    """
    model, preprocess = _load_model()

    response = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()

    img = Image.open(BytesIO(response.content)).convert("RGB")
    tensor = preprocess(img).unsqueeze(0).to(device)  # type: ignore

    with torch.no_grad():
        embedding = model.encode_image(tensor)

    return embedding.cpu().numpy()[0].astype(np.float32)
