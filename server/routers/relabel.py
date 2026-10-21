"""
routers/relabel.py

Backend for the "Relabel" page (static/relabel.html), a CAPTCHA-style tool for
fixing an item's tags one at a time:

    1. GET  /relabel/next   — pulls one clothing row (image + current tags) that
                              hasn't been relabeled yet.
    2. POST /relabel/submit — replaces the item's rows in "Tagged_Clothing" with
                              the chosen tags, records the item in the
                              "Relabeled_Clothing" table (see relabel_table.sql)
                              so it isn't served again, and updates the live
                              in-memory tag lookups.

Like the upload page, only tags that exist in the master "Tags" table are allowed
(GET /admin/tags lists them), and writing is only enabled where
ENABLE_ADMIN_UPLOAD=1 is set.

Endpoints:
    - GET  /relabel/next?include_relabeled=false
    - POST /relabel/submit
"""

import logging as log
import os
import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import supabase, supabase_execute as _supabase_execute
from routers.admin import _fetch_existing_tags
from services import Startup

router = APIRouter(prefix="/relabel")

# How many rows to look at per attempt when picking a random item, and how many attempts to make.
CANDIDATES_PER_TRY = 25
MAX_TRIES = 5


class SubmitRequest(BaseModel):
    item_id: int
    item_tags: list[str] = Field(default_factory=list)


def _writes_enabled() -> bool:
    return os.getenv("ENABLE_ADMIN_UPLOAD") == "1"


def _relabeled_among(item_ids: list[int]) -> set[int]:
    """Which of these items are already in the Relabeled_Clothing table."""
    response = _supabase_execute(
        supabase.table("Relabeled_Clothing").select("clothes_id").in_("clothes_id", item_ids)
    )
    return {int(row["clothes_id"]) for row in response.data}


def _tags_of(item_id: int) -> list[str]:
    """The item's current tags, straight from the Tagged_Clothing table."""
    response = _supabase_execute(
        supabase.table("Tagged_Clothing").select("Tag").eq("clothes_id", item_id)
    )
    return sorted(row["Tag"] for row in response.data)


@router.get("/next")
def next_item(include_relabeled: bool = False) -> dict:
    """
    One random clothing item for relabeling. Items already relabeled are skipped
    unless include_relabeled is set. Returns {"item": None} when none are left.
    """
    # SELECT count(*) FROM "Clothing"
    total = _supabase_execute(supabase.table("Clothing").select("item_id", count="exact").limit(1)).count or 0

    for _ in range(MAX_TRIES):
        # Take a small window of rows starting at a random position.
        start = random.randint(0, max(total - CANDIDATES_PER_TRY, 0))
        rows = _supabase_execute(
            supabase.table("Clothing")
            .select("item_id, item_name, item_img, item_web_listing")
            .order("item_id")
            .range(start, start + CANDIDATES_PER_TRY - 1)
        ).data
        if not rows:
            continue

        # Drop the ones already relabeled, unless they're wanted.
        if not include_relabeled:
            done = _relabeled_among([int(r["item_id"]) for r in rows])
            rows = [r for r in rows if int(r["item_id"]) not in done]
        if rows:
            item = random.choice(rows)
            item["item_tags"] = _tags_of(int(item["item_id"]))
            item["relabeled"] = bool(include_relabeled and _relabeled_among([int(item["item_id"])]))
            return {"item": item}

    # Random probing found nothing; say so unless there really are unrelabeled items left.
    if not include_relabeled:
        relabeled_count = _supabase_execute(
            supabase.table("Relabeled_Clothing").select("clothes_id", count="exact").limit(1)
        ).count or 0
        if relabeled_count < total:
            raise HTTPException(status_code=503, detail="Couldn't find an unlabeled item, try again.")
    return {"item": None}


@router.post("/submit")
def submit(req: SubmitRequest) -> dict:
    """Replaces an item's tags with the chosen ones and marks it as relabeled."""
    if not _writes_enabled():
        raise HTTPException(
            status_code=503,
            detail="Relabeling is disabled on this server. Run the server locally with ENABLE_ADMIN_UPLOAD=1.",
        )

    # Only tags from the master Tags table are allowed.
    known_tags = {t["Tag"] for t in _fetch_existing_tags()}
    unknown = [t for t in req.item_tags if t not in known_tags]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown tag(s): {', '.join(unknown)}.")

    tags = list(dict.fromkeys(req.item_tags))

    # The item has to exist.
    exists = _supabase_execute(supabase.table("Clothing").select("item_id").eq("item_id", req.item_id)).data
    if not exists:
        raise HTTPException(status_code=404, detail=f"No item with id {req.item_id}.")

    # Swap the tags: delete the old rows, insert the new ones.
    _supabase_execute(supabase.table("Tagged_Clothing").delete().eq("clothes_id", req.item_id))
    if tags:
        _supabase_execute(supabase.table("Tagged_Clothing").insert(
            [{"clothes_id": req.item_id, "Tag": tag} for tag in tags]
        ))

    # Remember it was relabeled so it isn't served again.
    _supabase_execute(supabase.table("Relabeled_Clothing").upsert({"clothes_id": req.item_id}))

    # Make filters see the new tags immediately.
    Startup.set_item_tags(req.item_id, tags)

    log.info(f"Relabeled item {req.item_id}: {tags}")
    return {"status": "ok", "item_id": req.item_id, "item_tags": tags}
