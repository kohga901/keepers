"""
routers/requests.py

Backend for "Request an item": signed-in users ask for a clothing item to be
added to the app, and an admin approves or rejects each request on the
"Requests" page (static/requests.html). Requests live in the "Item_Requests"
table (see item_requests_table.sql) until they are approved, at which point the
item goes through the same embed-and-insert flow as the Easy Upload page.

User endpoints (need an "Authorization: Bearer <token>" header; a user only ever
sees and changes their own requests):
    - POST /requests              — submit a request (starts as "pending")
    - GET  /requests/mine         — the caller's requests and their status
    - POST /requests/{id}/seen    — mark a finished request as shown to the user

Admin endpoints (only enabled where ENABLE_ADMIN_UPLOAD=1 is set, because
approving loads CLIP):
    - GET  /requests/admin/pending        — requests waiting for a decision (or that errored)
    - POST /requests/admin/{id}/approve   — upload the item and mark the request approved
    - POST /requests/admin/{id}/reject    — mark the request rejected, with an optional reason
"""

import ipaddress
import logging as log
import socket
from urllib.parse import urlparse

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from db import supabase, supabase_execute as _supabase_execute
from routers.admin import UploadItem, UploadRequest, _upload_enabled, upload_items
from routers.clothes import _user_from_token

router = APIRouter(prefix="/requests")

# How many requests one user can have waiting at once.
MAX_PENDING_PER_USER = 5

SIGN_IN_MESSAGE = "Sign in again to request an item."


# --- Request / Response models ---

class RequestIn(BaseModel):
    item_name: str = Field(min_length=1, max_length=200)
    item_img: str = Field(max_length=2000)                      # HTTPS link to the product photo.
    item_web_listing: str | None = Field(default=None, max_length=2000)
    item_price: str | None = Field(default=None, max_length=50)
    item_gender: str | None = Field(default=None, max_length=20)


class ApproveIn(BaseModel):
    # The admin may fix any field before approving; whatever is sent replaces the user's value.
    item_name: str = Field(min_length=1, max_length=200)
    item_img: str = Field(max_length=2000)
    item_web_listing: str | None = Field(default=None, max_length=2000)
    item_price: str | None = Field(default=None, max_length=50)
    item_gender: str | None = Field(default=None, max_length=20)
    item_tags: list[str] = Field(default_factory=list)


class RejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


# --- Helpers ---

def _clean(value: str | None) -> str | None:
    """Trims a string, turning blank into None."""
    value = (value or "").strip()
    return value or None


def _check_public_https(url: str, field: str) -> None:
    """
    Raises a 400 unless `url` is an https link to a public host. The server
    downloads item_img to embed it, so links to localhost or the local network
    (for example a cloud metadata address) must never be accepted.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=400, detail=f"{field} must be an https link.")
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror:
        raise HTTPException(status_code=400, detail=f"{field} could not be found.")
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise HTTPException(status_code=400, detail=f"{field} must point to a public website.")


def _require_admin() -> None:
    """Raises a 503 where approving is switched off (the hosted server)."""
    if not _upload_enabled():
        raise HTTPException(
            status_code=503,
            detail="Reviewing requests is disabled on this server. Run it locally with ENABLE_ADMIN_UPLOAD=1.",
        )


def _get_request(request_id: int) -> dict:
    """Returns one request row, or raises a 404."""
    # SELECT * FROM "Item_Requests" WHERE id = request_id
    response = _supabase_execute(supabase.table("Item_Requests").select("*").eq("id", request_id).limit(1))
    if not response.data:
        raise HTTPException(status_code=404, detail="Request not found.")
    return response.data[0]


# --- User endpoints ---

@router.post("")
def submit_request(req: RequestIn, authorization: str | None = Header(default=None)):
    """Saves a new pending request from the signed-in user."""
    user_id = _user_from_token(authorization, SIGN_IN_MESSAGE)

    row = {
        "user_id": user_id,
        "item_name": req.item_name.strip(),
        "item_img": req.item_img.strip(),
        "item_web_listing": _clean(req.item_web_listing),
        "item_price": _clean(req.item_price),
        "item_gender": _clean(req.item_gender),
    }
    if not row["item_name"]:
        raise HTTPException(status_code=400, detail="Give the item a name.")
    _check_public_https(row["item_img"], "The image link")
    if row["item_web_listing"]:
        _check_public_https(row["item_web_listing"], "The listing link")

    # Limit how many requests one user can have waiting.
    # SELECT id FROM "Item_Requests" WHERE user_id = ... AND status = 'pending'
    pending = _supabase_execute(
        supabase.table("Item_Requests").select("id").eq("user_id", user_id).eq("status", "pending")
    )
    if len(pending.data) >= MAX_PENDING_PER_USER:
        raise HTTPException(status_code=429, detail=f"You can have {MAX_PENDING_PER_USER} requests waiting at a time.")

    # Don't take an item that is already in the app or already requested.
    in_catalog = _supabase_execute(supabase.table("Clothing").select("item_id").eq("item_img", row["item_img"]).limit(1))
    already_requested = _supabase_execute(
        supabase.table("Item_Requests").select("id").eq("item_img", row["item_img"]).in_("status", ["pending", "approved"]).limit(1)
    )
    if in_catalog.data or already_requested.data:
        raise HTTPException(status_code=409, detail="That item is already in Keepers or has already been requested.")

    inserted = _supabase_execute(supabase.table("Item_Requests").insert(row))
    log.info("item request user=%s name=%r", user_id, row["item_name"])
    return {"status": "ok", "id": inserted.data[0]["id"]}


@router.get("/mine")
def my_requests(authorization: str | None = Header(default=None)):
    """The signed-in user's requests, newest first."""
    user_id = _user_from_token(authorization, SIGN_IN_MESSAGE)

    # SELECT ... FROM "Item_Requests" WHERE user_id = ... ORDER BY created_at DESC
    response = _supabase_execute(
        supabase.table("Item_Requests")
        .select("id, item_name, item_img, status, clothes_id, admin_note, seen_by_user, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(100)
    )
    return {"requests": response.data}


@router.post("/{request_id}/seen")
def mark_seen(request_id: int, authorization: str | None = Header(default=None)):
    """Marks one of the signed-in user's requests as shown, so the app stops highlighting it."""
    user_id = _user_from_token(authorization, SIGN_IN_MESSAGE)

    # UPDATE "Item_Requests" SET seen_by_user = true WHERE id = ... AND user_id = ...
    _supabase_execute(
        supabase.table("Item_Requests").update({"seen_by_user": True}).eq("id", request_id).eq("user_id", user_id)
    )
    return {"status": "ok"}


# --- Admin endpoints ---

@router.get("/admin/pending")
def pending_requests():
    """Requests waiting for a decision, plus ones whose last approval attempt errored. Oldest first."""
    _require_admin()

    # SELECT ... FROM "Item_Requests" WHERE status IN ('pending', 'error') ORDER BY created_at
    response = _supabase_execute(
        supabase.table("Item_Requests")
        .select("id, item_name, item_img, item_web_listing, item_price, item_gender, status, admin_note, created_at")
        .in_("status", ["pending", "error"])
        .order("created_at")
        .limit(200)
    )
    return {"requests": response.data}


@router.post("/admin/{request_id}/approve")
def approve_request(request_id: int, req: ApproveIn):
    """Uploads the (possibly edited) item through the Easy Upload flow and marks the request approved."""
    _require_admin()

    row = _get_request(request_id)
    if row["status"] not in ("pending", "error"):
        raise HTTPException(status_code=409, detail=f"This request was already {row['status']}.")

    item_img = req.item_img.strip()
    item_web_listing = _clean(req.item_web_listing)
    _check_public_https(item_img, "The image link")
    if item_web_listing:
        _check_public_https(item_web_listing, "The listing link")

    item = UploadItem(
        item_name=req.item_name.strip(),
        item_img=item_img,
        item_price=_clean(req.item_price),
        item_gender=_clean(req.item_gender),
        item_web_listing=item_web_listing,
        item_tags=req.item_tags,
    )
    result = upload_items(UploadRequest(items=[item])).results[0]

    if result.status == "ok":
        update = {"status": "approved", "clothes_id": result.item_id, "admin_note": None, "seen_by_user": False}
    else:
        update = {"status": "error", "admin_note": result.error}
    _supabase_execute(supabase.table("Item_Requests").update(update).eq("id", request_id))

    return {"status": result.status, "item_id": result.item_id, "error": result.error}


@router.post("/admin/{request_id}/reject")
def reject_request(request_id: int, req: RejectIn):
    """Marks a request rejected, with an optional reason the user can see."""
    _require_admin()

    row = _get_request(request_id)
    if row["status"] not in ("pending", "error"):
        raise HTTPException(status_code=409, detail=f"This request was already {row['status']}.")

    _supabase_execute(
        supabase.table("Item_Requests")
        .update({"status": "rejected", "admin_note": _clean(req.reason), "seen_by_user": False})
        .eq("id", request_id)
    )
    return {"status": "ok"}
