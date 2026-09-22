"""
routers/admin.py

Backend for the "Easy Upload" page (static/upload.html): lets someone paste
in one or more clothing items (each with an image link, and optionally a
listing link, price, gender, tags) and, in one request:

    1. Downloads each image and runs it through CLIP to get its embedding.
    2. Inserts the item into the "Clothing" table.
    3. Inserts its embedding into the "Embeddings" table.
    4. Adds the embedding to the live in-memory FAISS index (services/Startup.py)
       so it shows up in recommendations immediately, without a server restart.

Endpoints:
    - POST /admin/upload — upload one or more clothing items at once
"""

import logging as log

from fastapi import APIRouter
from pydantic import BaseModel, Field

from db import supabase
from services import Startup, clip_service

router = APIRouter(prefix="/admin")


# --- Request / Response models ---

class UploadItem(BaseModel):
    item_name: str
    item_img: str                       # HTTPS link to the product photo — required, this is what gets embedded.
    item_price: str | None = None
    item_gender: str | None = None      # "men" | "women" | "unisex", freeform is fine too.
    item_web_listing: str | None = None # HTTPS link to the product page, if different from the image.
    item_tags: list[str] = Field(default_factory=list)


class UploadRequest(BaseModel):
    items: list[UploadItem]


class UploadResult(BaseModel):
    item_name: str
    status: str          # "ok" | "error"
    item_id: int | None = None
    error: str | None = None


class UploadResponse(BaseModel):
    results: list[UploadResult]


# --- Helpers ---

def _supabase_execute(query, retries: int = 3, delay: float = 0.5):
    import time
    for attempt in range(retries):
        try:
            return query.execute()
        except Exception:
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise


def _next_item_id() -> int:
    """Fetches the current highest item_id in the Clothing table and returns id + 1."""
    response = _supabase_execute(
        supabase.table("Clothing").select("item_id").order("item_id", desc=True).limit(1)
    )
    if not response.data:
        return 1
    return int(response.data[0]["item_id"]) + 1


# --- Endpoints ---

@router.post("/upload")
def upload_items(req: UploadRequest) -> UploadResponse:
    """
    Embeds and inserts one or more clothing items. Each item is processed
    independently — one bad image link won't fail the rest of the batch.
    """
    results: list[UploadResult] = []

    # Track ids handed out within this batch so two items in the same
    # request don't collide before either has hit the DB.
    next_id = _next_item_id()

    for item in req.items:
        try:
            # 1. Embed the image.
            raw_embedding = clip_service.embed_image_url(item.item_img)

            # 2. Reserve an id and insert the Clothing row.
            item_id = next_id
            next_id += 1

            clothing_row = {
                "item_id": item_id,
                "item_name": item.item_name,
                "item_price": item.item_price,
                "item_gender": item.item_gender,
                "item_img": item.item_img,
                "item_web_listing": item.item_web_listing,
            }
            if item.item_tags:
                clothing_row["item_tags"] = item.item_tags

            _supabase_execute(supabase.table("Clothing").insert(clothing_row))

            # 3. Insert the embedding.
            _supabase_execute(supabase.table("Embeddings").insert({
                "item_id": item_id,
                "embedding": raw_embedding.tolist(),
            }))

            # 4. Make it immediately recommendable.
            Startup.add_item_embedding(item_id, raw_embedding)

            results.append(UploadResult(item_name=item.item_name, status="ok", item_id=item_id))

        except Exception as e:
            log.error(f"Failed to upload item '{item.item_name}': {e}")
            results.append(UploadResult(item_name=item.item_name, status="error", error=str(e)))

    return UploadResponse(results=results)
