"""
routers/clothes.py

Defines the API routes for clothing-related operations in the Keepers app.

Endpoints:
    - POST /clothes/swipe           — record a like or dislike swipe for a clothing item
    - POST /clothes/recommendations — return personalised recommendations based on the user's preference vector
"""
from typing import Any
import logging
import random
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
import numpy as np

from db import supabase, supabase_execute as _supabase_execute
from services import Startup, user_state
from services.recommendation_service import compute_pref_vec, estimate_coordinates, get_recommendations

log = logging.getLogger(__name__)

router = APIRouter(prefix="/clothes")

# The stored pref_vec and map coordinates are refreshed once every this many swipes.
SYNC_EVERY = 4

# The app only asks for its next batch when it has 2 cards left, which a quick
# swiper gets through before the batch arrives. So the server sends extra cards
# whenever the user has fewer than this many still waiting in their deck.
DECK_BUFFER = 6

# --- Request / Response models ---

class SwipeData(BaseModel):
    user_id: str
    item_id: int
    liked: bool

class RecommendationRequest(BaseModel):
    user_id: str
    n: int = 10
    categories: list[str] = Field(default_factory=list)


class ClothingItem(BaseModel):
    item_id: int
    item_name: str
    item_price: str | None
    item_gender: str | None
    item_img: str | None
    item_web_listing: str | None
    item_tags: list[str] | None = None

class RecommendationResponse(BaseModel):
    recommendations: list[ClothingItem]

class History(BaseModel):
    user_id: str
    items: list[dict[Any,Any]]


# --- Helpers ---
def _matches_filters(item: dict, req: RecommendationRequest) -> bool:
    if req.categories == []:
        return True
    item_tags = item.get("item_tags") or []
    return any(tag in req.categories for tag in item_tags)


def _fetch_clothing_items(item_ids: list[int]) -> list[dict]:
    """
    DB function. Fetch clothing items based on item_id's and then return a dictionary 
    """
    # SELECT * FROM "Clothing" WHERE item_id IN (list of item_id's)
    response = _supabase_execute(supabase.table("Clothing").select("*").in_("item_id", item_ids))

    # Go through the item_ids and put the FAISS ranking and their FAISS ranking in a dict.
    # dict = {ranking : index of item in the item_ids list}
    order = {i: idx for idx, i in enumerate(item_ids)}
    
    # Return the 
    return sorted(response.data, key=lambda x: order.get(x["item_id"], 999))

def _save_pref_vec(user_id: str, pref_vec: np.ndarray) -> None:
    """
    DB function. Replace a user's pref_vec with a new pref_vec.
    """
    # Make a SQL insert query.
    _supabase_execute(supabase.table("User_Preferences").upsert({
        "user_id": user_id,
        "pref_vec": pref_vec.tolist()
    }))

def _record_swipe(user_id: str, item_id: int, liked: bool) -> None:
    """
    DB function. Records a user's swipe and update the db.
    """
    # Set table to insert into.
    table = "Likes" if liked else "Dislikes"

    # Make a SQL insert query.
    _supabase_execute(supabase.table(table).upsert({
        "user_id": user_id,
        "clothes_id": item_id
    }))

def _remove_swipe(user_id: str, item_id: int, liked: bool) -> None:
    """
    DB function. Removes an item from a user's Likes (liked=True) or Dislikes (liked=False).
    """
    table = "Likes" if liked else "Dislikes"

    _supabase_execute(supabase.table(table).delete().eq("user_id", user_id).eq("clothes_id", item_id))

def _update_user_coordinates(user_id: str, pref_vec: np.ndarray) -> None:
    """
    DB function, takes a user's pref_vec and converts it to x, y coordinates and uploads it to db.
    """
    coords = estimate_coordinates(pref_vec)

    if coords is None:
        return

    _supabase_execute(supabase.table("Coordinates").upsert({
        "user_id": user_id,
        "x": coords[0],
        "y": coords[1]
    }))

def _sync_user(user_id: str, liked_ids: list[int], disliked_ids: list[int]) -> None:
    """
    DB function. Saves a user's current pref_vec and map coordinates. Runs as a
    background task so the swipe that triggered it doesn't wait for it.
    """
    try:
        pref_vec = compute_pref_vec(liked_ids, disliked_ids)
        _save_pref_vec(user_id, pref_vec)

        # A user with no likes has an all 0 pref_vec, which has no place on the map.
        if np.any(pref_vec):
            _update_user_coordinates(user_id, pref_vec)
    except Exception:
        log.exception("Failed to save pref_vec/coordinates for user %s", user_id)

def _fetch_liked_item_ids(user_id: str):
    response = _supabase_execute(supabase.table("Likes").select("clothes_id").eq("user_id",user_id))
    return [row["clothes_id"] for row in response.data]

def _fetch_disliked_item_ids(user_id: str):
    response = _supabase_execute(supabase.table("Dislikes").select("clothes_id").eq("user_id",user_id))
    return [row["clothes_id"] for row in response.data]

# --- Endpoints ---


@router.post("/swipe")
def swipe(req: SwipeData, background_tasks: BackgroundTasks):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")
    
    """
    DB function. Takes a SwipeData object and updates the db with the relative information:
        - User's pref_vec.
        - User's Like/Dislike history.
    """
    
    # Save and upload the swipe data to the db. This is the only db call the
    # client waits for; the pref_vec is rebuilt from the swipe history on demand.
    _record_swipe(req.user_id, req.item_id, req.liked)

    # Apply the swipe to the in-memory history.
    liked_ids, disliked_ids, switched = user_state.record_swipe(req.user_id, req.item_id, req.liked)

    log.info("swipe user=%s item=%s liked=%s (likes=%d dislikes=%d)",
             req.user_id, req.item_id, req.liked, len(liked_ids), len(disliked_ids))

    # An item can only be liked or disliked, not both. Remove the earlier opposite swipe.
    if switched:
        background_tasks.add_task(_remove_swipe, req.user_id, req.item_id, not req.liked)

    # Save the pref_vec and coordinates every few swipes only.
    if (len(liked_ids) + len(disliked_ids)) % SYNC_EVERY == 0:
        background_tasks.add_task(_sync_user, req.user_id, liked_ids, disliked_ids)

    # Return status to client.
    return {"status": "ok"}

@router.post("/recommendations")
def recommendations(req: RecommendationRequest) -> RecommendationResponse:

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")

    started = time.perf_counter()

    # Get the swipe history of the user, plus the items to keep out of this batch:
    # everything they have swiped on and everything already sent to their deck.
    liked_ids, disliked_ids, excluded_ids, in_deck = user_state.snapshot(req.user_id)

    # Top the deck up if it is running low.
    n = req.n + max(0, DECK_BUFFER - in_deck)

    # Build the pref_vec of the user from their swipe history.
    pref_vec = compute_pref_vec(liked_ids, disliked_ids)

    # If the pref_vec of a user is 0, get random unseen items.
    if not np.any(pref_vec):
        with Startup._index_lock:
            unseen_ids = [i for i in Startup._item_ids if i not in excluded_ids]
        results = random.sample(unseen_ids, k=min(n * 5, len(unseen_ids)))
    else:
        results = get_recommendations(pref_vec, excluded_ids, n=n*5, batch_size=n)

    # Fetch the recommended items from the db.
    items = _fetch_clothing_items(results) if results else []
    items = [i for i in items if _matches_filters(i, req)]
    items = items[:n]

    # Remember what was sent so the next batch doesn't repeat cards still in the deck.
    user_state.mark_served(req.user_id, [i["item_id"] for i in items])

    log.info("recommendations user=%s sent=%d/%d personalised=%s (likes=%d dislikes=%d in_deck=%d) took=%dms",
             req.user_id, len(items), n, bool(np.any(pref_vec)), len(liked_ids), len(disliked_ids), in_deck,
             (time.perf_counter() - started) * 1000)

    # Send HTTP POST response to client.
    return RecommendationResponse(recommendations=items)

@router.post("/recommendations/debug")
def recommendations_debug(req: RecommendationRequest):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")
    
    from services.recommendation_service import get_recommendations_with_scores
    liked_ids, disliked_ids, excluded_ids, _ = user_state.snapshot(req.user_id)
    pref_vec = compute_pref_vec(liked_ids, disliked_ids)
    results = get_recommendations_with_scores(pref_vec, excluded_ids, n=req.n)
    return {"recommendations": [{"item_id": r[0], "score": r[1]} for r in results]}

@router.get("/liked/{user_id}")
def get_liked_items(user_id: str) -> History:
    item_ids = _fetch_liked_item_ids(user_id)
    items = _fetch_clothing_items(item_ids)
    return History(items=items,user_id=user_id)

@router.get("/disliked/{user_id}")
def get_disliked_items(user_id: str) -> History:
    item_ids = _fetch_disliked_item_ids(user_id)
    items = _fetch_clothing_items(item_ids)
    return History(items=items,user_id=user_id)