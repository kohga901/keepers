"""
routers/clothes.py

Defines the API routes for clothing-related operations in the Keepers app.

Endpoints:
    - POST /clothes/swipe           — record a like or dislike swipe for a clothing item
    - POST /clothes/recommendations — return personalised recommendations based on the user's preference vector, optionally filtered by tags
    - GET  /clothes/tags            — list the tags (with category) recommendations can be filtered by
    - GET    /clothes/liked/{user_id}              — list the items a user has liked
    - GET    /clothes/disliked/{user_id}           — list the items a user has disliked
    - DELETE /clothes/liked/{user_id}/{item_id}    — remove an item from a user's likes
    - DELETE /clothes/disliked/{user_id}/{item_id} — remove an item from a user's dislikes
    - POST   /clothes/history/clear                — wipe the signed-in user's likes, dislikes, or both
"""
from typing import Any, Literal
import logging
import random
import time

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel, Field
import numpy as np

from db import supabase, supabase_execute as _supabase_execute
from services import Startup, user_state
from services.recommendation_service import compute_pref_vec, estimate_coordinates, filtered_like_share, get_recommendations

log = logging.getLogger(__name__)

router = APIRouter(prefix="/clothes")

# The stored pref_vec and map coordinates are refreshed once every this many swipes.
SYNC_EVERY = 4

# --- Request / Response models ---

class SwipeData(BaseModel):
    user_id: str
    item_id: int
    liked: bool

class RecommendationRequest(BaseModel):
    user_id: str
    n: int = 10
    # Tags to filter by. Tags of the same category are alternatives, different
    # categories must all match (see Startup.resolve_filter). Empty means no filter.
    categories: list[str] = Field(default_factory=list)


class ClothingItem(BaseModel):
    item_id: int
    item_name: str
    item_price: str | None
    item_gender: str | None
    item_img: str | None
    item_web_listing: str | None
    item_tags: list[str] | None = None
    # True for an item the user asked for (see routers/requests.py) that was approved since they last saw it.
    requested_by_you: bool = False

class RecommendationResponse(BaseModel):
    recommendations: list[ClothingItem]

class History(BaseModel):
    user_id: str
    items: list[dict[Any,Any]]

class ClearHistoryRequest(BaseModel):
    # "liked" and "disliked" clear one list; "all" resets the account's swipe history and taste.
    scope: Literal["liked", "disliked", "all"]


# --- Helpers ---
def _fetch_clothing_items(item_ids: list[int]) -> list[dict]:
    """
    DB function. Fetch clothing items based on item_id's and then return a dictionary
    """
    # SELECT * FROM "Clothing" WHERE item_id IN (list of item_id's)
    response = _supabase_execute(supabase.table("Clothing").select("*").in_("item_id", item_ids))

    # Go through the item_ids and put each item_id and its ranking in a dict.
    # dict = {item_id : index of item in the item_ids list}
    order = {i: idx for idx, i in enumerate(item_ids)}

    # Return the items in the same order as item_ids.
    return sorted(response.data, key=lambda x: order.get(x["item_id"], 999))

def _take_approved_requests(user_id: str, limit: int) -> tuple[list[dict], list[int]]:
    """
    DB function. Returns up to `limit` of the user's approved item requests that they haven't been
    shown yet, as Clothing rows, plus the ids of the requests so they can be marked seen afterwards.
    Any failure just means no requested items this time, so it never breaks the feed.
    """
    try:
        # SELECT id, clothes_id FROM "Item_Requests" WHERE user_id = ... AND status = 'approved' AND seen_by_user = false
        response = _supabase_execute(
            supabase.table("Item_Requests")
            .select("id, clothes_id")
            .eq("user_id", user_id)
            .eq("status", "approved")
            .eq("seen_by_user", False)
            .not_.is_("clothes_id", "null")
            .order("created_at")
            .limit(limit)
        )
        if not response.data:
            return [], []

        # Keep each request paired with its item, in case an item row has gone missing.
        items = {item["item_id"]: item for item in _fetch_clothing_items([r["clothes_id"] for r in response.data])}
        taken = [r for r in response.data if r["clothes_id"] in items]
        return [items[r["clothes_id"]] for r in taken], [r["id"] for r in taken]
    except Exception as e:
        log.warning("Could not load approved item requests for user=%s: %r", user_id, e)
        return [], []

def _mark_requests_seen(request_ids: list[int]) -> None:
    """
    DB function. Marks item requests as shown to the user, so they aren't put at the front of the feed again.
    """
    try:
        # UPDATE "Item_Requests" SET seen_by_user = true WHERE id IN (request_ids)
        _supabase_execute(supabase.table("Item_Requests").update({"seen_by_user": True}).in_("id", request_ids))
    except Exception as e:
        log.warning("Could not mark item requests %s as seen: %r", request_ids, e)

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
    # Set table to delete from.
    table = "Likes" if liked else "Dislikes"

    # Make a SQL delete query.
    _supabase_execute(supabase.table(table).delete().eq("user_id", user_id).eq("clothes_id", item_id))

def _update_user_coordinates(user_id: str, pref_vec: np.ndarray) -> None:
    """
    DB function, takes a user's pref_vec and converts it to x, y coordinates and uploads it to db.
    """
    # Convert the pref_vec to x, y coordinates on the item map.
    coords = estimate_coordinates(pref_vec)

    # No position could be worked out, so leave the stored one as is.
    if coords is None:
        return

    # Make a SQL insert query.
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
        # Build the pref_vec of the user from their swipe history.
        pref_vec = compute_pref_vec(liked_ids, disliked_ids)

        # Save and upload the pref_vec to db.
        _save_pref_vec(user_id, pref_vec)

        # A user with no likes has an all 0 pref_vec, which has no place on the map.
        if np.any(pref_vec):
            _update_user_coordinates(user_id, pref_vec)
    except Exception:
        # Nothing is waiting on this task, so log the failure instead of raising.
        log.exception("Failed to save pref_vec/coordinates for user %s", user_id)

def _fetch_liked_item_ids(user_id: str):
    # SELECT clothes_id FROM "Likes" WHERE user_id = user_id
    response = _supabase_execute(supabase.table("Likes").select("clothes_id").eq("user_id",user_id))
    return [row["clothes_id"] for row in response.data]

def _fetch_disliked_item_ids(user_id: str):
    # SELECT clothes_id FROM "Dislikes" WHERE user_id = user_id
    response = _supabase_execute(supabase.table("Dislikes").select("clothes_id").eq("user_id",user_id))
    return [row["clothes_id"] for row in response.data]

def _undo_swipe(user_id: str, item_id: int, liked: bool, background_tasks: BackgroundTasks) -> None:
    """
    Removes an item from a user's likes (liked=True) or dislikes (liked=False),
    in the db and in the in-memory history.
    """
    # Delete the swipe from the db.
    _remove_swipe(user_id, item_id, liked)

    # Remove the swipe from the in-memory history.
    liked_ids, disliked_ids = user_state.remove_swipe(user_id, item_id, liked)

    # Log the removal.
    log.info("unswipe user=%s item=%s liked=%s (likes=%d dislikes=%d)",
             user_id, item_id, liked, len(liked_ids), len(disliked_ids))

    # The swipe history changed, so save the new pref_vec and coordinates.
    background_tasks.add_task(_sync_user, user_id, liked_ids, disliked_ids)

def _user_from_token(authorization: str | None, detail: str = "Sign in again to clear your history.") -> str:
    """
    Returns the id of the user who owns the Supabase access token in an
    "Authorization: Bearer <token>" header, so a user can only change their own data.
    `detail` is the message returned with the 401 error.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail=detail)
    try:
        response = supabase.auth.get_user(authorization[7:].strip())
    except Exception:
        raise HTTPException(status_code=401, detail=detail)
    if not response or not response.user:
        raise HTTPException(status_code=401, detail=detail)
    return response.user.id

def _clear_taste(user_id: str) -> None:
    """
    DB function. Deletes a user's stored pref_vec and map coordinates. With no likes
    left there is no taste to show, and the next swipes rebuild both.
    """
    _supabase_execute(supabase.table("User_Preferences").delete().eq("user_id", user_id))
    _supabase_execute(supabase.table("Coordinates").delete().eq("user_id", user_id))

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

    # Log the swipe.
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

@router.post("/history/clear")
def clear_history(req: ClearHistoryRequest, authorization: str | None = Header(default=None)):
    """
    DB function. Wipes the signed-in user's likes, dislikes, or both, and updates
    their stored taste to match.
    """
    user_id = _user_from_token(authorization)

    # Hold the user's lock so a swipe or recommendation can't use the old history mid-clear.
    with user_state.user_lock(user_id):
        if req.scope in ("liked", "all"):
            _supabase_execute(supabase.table("Likes").delete().eq("user_id", user_id))
        if req.scope in ("disliked", "all"):
            _supabase_execute(supabase.table("Dislikes").delete().eq("user_id", user_id))

        # The in-memory history is now out of date, so reload it on the next request.
        user_state.forget(user_id)

    # Likes drive the taste, so without them there is nothing to keep. Clearing only
    # dislikes keeps the likes, so rebuild the taste from them.
    if req.scope in ("liked", "all"):
        _clear_taste(user_id)
    else:
        _sync_user(user_id, _fetch_liked_item_ids(user_id), [])

    log.info("clear history user=%s scope=%s", user_id, req.scope)
    return {"status": "ok"}

@router.post("/recommendations")
def recommendations(req: RecommendationRequest, background_tasks: BackgroundTasks) -> RecommendationResponse:

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")

    # Start timing the request.
    started = time.perf_counter()

    # Hold the user's lock from reading their history until the batch is recorded as
    # sent, so two requests for the same user can never be given the same item.
    with user_state.user_lock(req.user_id):
        # Get the swipe history of the user, plus the items to keep out of this batch:
        # everything they have swiped on and everything already sent to them.
        liked_ids, disliked_ids, excluded_ids = user_state.snapshot(req.user_id)

        # Number of items the client asked for.
        n = req.n

        # Items allowed by the tag filter, or None if there is no filter.
        allowed_ids = Startup.resolve_filter(req.categories)

        # Build the pref_vec of the user from their swipe history.
        pref_vec = compute_pref_vec(liked_ids, disliked_ids)

        # If the pref_vec of a user is 0, get random unseen items.
        if not np.any(pref_vec):
            with Startup._index_lock:
                unseen_ids = [i for i in Startup._item_ids
                              if i not in excluded_ids and (allowed_ids is None or i in allowed_ids)]
            results = random.sample(unseen_ids, k=min(n * 5, len(unseen_ids)))

            # Drop later copies of the same product from the sample.
            results = Startup.drop_duplicates(results)
        # Otherwise get the items recommended for the pref_vec.
        else:
            # With no filter, explore more if the user's recent likes were made under one.
            boost = 0.0 if allowed_ids is not None else filtered_like_share(liked_ids, user_state.filtered_ids(req.user_id))
            results = get_recommendations(pref_vec, excluded_ids, n=n*5, batch_size=n,
                                          allowed_ids=allowed_ids, explore_boost=boost)

        # Fetch the recommended items from the db.
        items = _fetch_clothing_items(results) if results else []

        # Items the user asked for that were approved go first, so they can see the request worked.
        # A tag filter is the user choosing what to see, so they wait until it is cleared.
        requested_items, requested_request_ids = ([], []) if req.categories else _take_approved_requests(req.user_id, n)
        for item in requested_items:
            item["requested_by_you"] = True
        requested_ids = {item["item_id"] for item in requested_items}

        # Keep the first n items. They all passed the tag filter already.
        items = requested_items + [i for i in items if i["item_id"] not in requested_ids]
        items = items[:n]

        # Attach each item's tags.
        for item in items:
            item["item_tags"] = sorted(Startup.item_tags.get(item["item_id"], ()))

        # Remember what was sent so it is never sent to this user again.
        user_state.mark_served(req.user_id, [i["item_id"] for i in items], filtered=allowed_ids is not None)

        # The requested items are on their way, so they won't be put first again.
        if requested_request_ids:
            background_tasks.add_task(_mark_requests_seen, requested_request_ids)

    # Log the request and how long it took.
    log.info("recommendations user=%s sent=%d/%d personalised=%s (likes=%d dislikes=%d) took=%dms",
             req.user_id, len(items), n, bool(np.any(pref_vec)), len(liked_ids), len(disliked_ids),
             (time.perf_counter() - started) * 1000)

    # Send HTTP POST response to client.
    return RecommendationResponse(recommendations=items)

@router.get("/tags")
def get_tags() -> dict[str, list[dict[str, str]]]:
    """
    Every tag the recommendations can be filtered by, with its category, for the app's filter picker.
    """
    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")

    # Only list tags that at least one item carries, since the others would filter everything out.
    tags = [{"Tag": tag, "Category": category}
            for tag, category in Startup.tag_category.items() if Startup.tag_items.get(tag)]
    return {"tags": sorted(tags, key=lambda t: (t["Category"], t["Tag"]))}

@router.post("/recommendations/debug")
def recommendations_debug(req: RecommendationRequest):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")

    from services.recommendation_service import get_recommendations_with_scores

    # Get the swipe history of the user and the items to keep out of the results.
    liked_ids, disliked_ids, excluded_ids = user_state.snapshot(req.user_id)

    # Build the pref_vec of the user from their swipe history.
    pref_vec = compute_pref_vec(liked_ids, disliked_ids)

    # Get the n nearest unseen items with their similarity scores.
    results = get_recommendations_with_scores(pref_vec, excluded_ids, n=req.n)

    # Return each item_id with its score.
    return {"recommendations": [{"item_id": r[0], "score": r[1]} for r in results]}

@router.get("/liked/{user_id}")
def get_liked_items(user_id: str) -> History:
    # Get the item_id's the user has liked.
    item_ids = _fetch_liked_item_ids(user_id)

    # Fetch those items from the db.
    items = _fetch_clothing_items(item_ids)
    return History(items=items,user_id=user_id)

@router.get("/disliked/{user_id}")
def get_disliked_items(user_id: str) -> History:
    # Get the item_id's the user has disliked.
    item_ids = _fetch_disliked_item_ids(user_id)

    # Fetch those items from the db.
    items = _fetch_clothing_items(item_ids)
    return History(items=items,user_id=user_id)

@router.delete("/liked/{user_id}/{item_id}")
def remove_liked_item(user_id: str, item_id: int, background_tasks: BackgroundTasks):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")

    # Remove the item from the likes of the user.
    _undo_swipe(user_id, item_id, True, background_tasks)

    # Return status to client.
    return {"status": "ok"}

@router.delete("/disliked/{user_id}/{item_id}")
def remove_disliked_item(user_id: str, item_id: int, background_tasks: BackgroundTasks):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")

    # Remove the item from the dislikes of the user.
    _undo_swipe(user_id, item_id, False, background_tasks)

    # Return status to client.
    return {"status": "ok"}
