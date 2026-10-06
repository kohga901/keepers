"""
routers/admin.py

Backend for the "Easy Upload" page (static/upload.html): lets someone paste
in one or more clothing items (each with an image link, and optionally a
listing link, price, gender, tags) and, in one request:

    1. Downloads each image and runs it through CLIP to get its embedding.
    2. Inserts the item into the "Clothing" table.
    3. Inserts its embedding into the "Embeddings" table.
    4. Links any chosen tags to the item in the "Tagged_Clothing" join table.
    5. Adds the embedding to the live in-memory FAISS index (services/Startup.py)
       so it shows up in recommendations immediately, without a server restart.

Tags themselves are never created here — /admin/tags only ever returns tags
that already exist in the master "Tags" table (columns: Tag, Category), and
/admin/upload rejects any tag that isn't in that table. This keeps the tag
vocabulary in sync with whatever the tagging pipeline/other engineer produces.

Endpoints:
    - GET  /admin/tags   — list existing tags (with category) for the upload page's tag picker
    - POST /admin/upload — upload one or more clothing items at once
"""

import logging as log
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import supabase, supabase_execute as _supabase_execute
from services import Startup, clip_service

router = APIRouter(prefix="/admin")


def _upload_enabled() -> bool:
    """
    Uploading loads torch + CLIP, which doesn't fit in the hosted server's
    512 MB. It is only allowed where ENABLE_ADMIN_UPLOAD=1 is set (a local run).
    """
    return os.getenv("ENABLE_ADMIN_UPLOAD") == "1"


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

def _next_item_id() -> int:
    """Fetches the current highest item_id in the Clothing table and returns id + 1."""
    response = _supabase_execute(
        supabase.table("Clothing").select("item_id").order("item_id", desc=True).limit(1)
    )
    if not response.data:
        return 1
    return int(response.data[0]["item_id"]) + 1


def _fetch_existing_tags() -> list[dict]:
    """
    Returns every tag in the master "Tags" table (columns: Tag, Category), sorted
    by tag name. This is the authoritative tag list shared with the tagging
    pipeline — the upload page must only offer tags from here, never invent new ones.
    Pages through the table because Supabase caps a single select at 1000 rows.
    """
    tags: list[dict] = []
    page_size = 1000
    start = 0
    while True:
        response = _supabase_execute(
            supabase.table("Tags").select("Tag, Category").range(start, start + page_size - 1)
        )
        tags.extend(response.data)
        if len(response.data) < page_size:
            break
        start += page_size
    tags.sort(key=lambda t: t["Tag"])
    return tags


def _tag_clothing_item(item_id: int, tags: list[str]) -> None:
    """Links a clothing item to its tags via the Tagged_Clothing join table."""
    if not tags:
        return
    _supabase_execute(supabase.table("Tagged_Clothing").insert([
        {"clothes_id": item_id, "Tag": tag} for tag in tags
    ]))


# --- Endpoints ---

@router.get("/tags")
def get_tags() -> dict[str, list[dict]]:
    """Existing tags (with their category) from the master Tags table."""
    return {"tags": _fetch_existing_tags()}


@router.post("/upload")
def upload_items(req: UploadRequest) -> UploadResponse:
    """
    Embeds and inserts one or more clothing items. Each item is processed
    independently — one bad image link won't fail the rest of the batch.
    """
    if not _upload_enabled():
        raise HTTPException(
            status_code=503,
            detail="Uploading is disabled on this server. Run the server locally with ENABLE_ADMIN_UPLOAD=1 to add items.",
        )

    results: list[UploadResult] = []

    # Track ids handed out within this batch so two items in the same
    # request don't collide before either has hit the DB.
    next_id = _next_item_id()

    # Only tags that already exist in the master Tags table are allowed (kept in
    # sync with whatever the tagging pipeline produced); fetched once per request.
    known_tags = {t["Tag"] for t in _fetch_existing_tags()}

    for item in req.items:
        try:
            unknown = [t for t in item.item_tags if t not in known_tags]
            if unknown:
                raise ValueError(f"Unknown tag(s): {', '.join(unknown)}. Only existing tags are allowed.")

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

            _supabase_execute(supabase.table("Clothing").insert(clothing_row))

            # 3. Insert the embedding.
            _supabase_execute(supabase.table("Embeddings").insert({
                "item_id": item_id,
                "embedding": raw_embedding.tolist(),
            }))

            # 4. Link the item to its tags (if any) in the join table.
            _tag_clothing_item(item_id, item.item_tags)

            # 5. Make it immediately recommendable.
            Startup.add_item_embedding(item_id, raw_embedding)

            results.append(UploadResult(item_name=item.item_name, status="ok", item_id=item_id))

        except Exception as e:
            log.error(f"Failed to upload item '{item.item_name}': {e}")
            results.append(UploadResult(item_name=item.item_name, status="error", error=str(e)))

    return UploadResponse(results=results)
