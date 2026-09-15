"""
routers/clothes.py

Defines the API routes for clothing-related operations in the Keepers app.

Endpoints:
    - POST /clothes/swipe           — record a like or dislike swipe for a clothing item
    - POST /clothes/recommendations — return personalised recommendations based on the user's preference vector
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import json
from services.Startup import EMBEDDING_DIM
import random
from db import supabase
from services.recommendation_service import get_recommendations
from services import Startup
import time
from fastapi import BackgroundTasks


def _supabase_execute(query, retries=3, delay=0.5):
    for attempt in range(retries):
        try:
            return query.execute()
        except Exception:
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise


router = APIRouter(prefix="/clothes")

ALPHA = 0.3
BETA  = 0.2

# --- Request / Response models ---

class SwipeData(BaseModel):
    user_id: str
    item_id: int
    liked: bool

class RecommendationRequest(BaseModel):
    user_id: str
    n: int = 10

class ClothingItem(BaseModel):
    item_id: int
    item_name: str
    item_price: str | None
    item_gender: str | None
    item_img: str | None
    item_web_listing: str | None

class RecommendationResponse(BaseModel):
    recommendations: list[ClothingItem]


# --- Helpers ---
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

def _fetch_pref_vec(user_id: str) -> np.ndarray:
    """
    DB function. Fetches a user's preference vector from the db.
    """
    # SQL query to db.
    response = _supabase_execute(supabase.table("User_Preferences").select("pref_vec").eq("user_id", user_id))

    # If user has no preference vector, initialize it all to 0.
    if not response.data or response.data[0]["pref_vec"] is None:

        # Return an all 0 vector.
        return np.zeros(EMBEDDING_DIM, dtype=np.float32)
    
    # Return preference vector
    return np.array(json.loads(response.data[0]["pref_vec"]), dtype=np.float32)

def _update_pref_vec(pref_vec: np.ndarray, item_id: int, liked: bool) -> np.ndarray:
    """
    Updates a preference vector with a given vector and liked status.

    Returns:
        New preference vector.
    """
    # Get item's embedding.
    item_embedding = Startup.item_id_to_embedding.get(item_id)

    # If item's embedding is 0 or non existent.
    if item_embedding is None:
        # Just return back the preference vector as is.
        return pref_vec
    
    if liked:
        # Add the item's embedding to the pref_vec.
        pref_vec = pref_vec + ALPHA * item_embedding
    else:
         # Deduct the item's embedding from the pref_vec.
        pref_vec = pref_vec - BETA * item_embedding

    return pref_vec

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

def _fetch_seen_item_ids(user_id: str) -> list[int]:
    """
    DB function. Fetch the item_id's of clothes that the user has already seen.
    """
    # Likes of the user.
    likes    = _supabase_execute(supabase.table("Likes").select("clothes_id").eq("user_id", user_id))

    # Dislikes of the user.
    dislikes = _supabase_execute(supabase.table("Dislikes").select("clothes_id").eq("user_id", user_id))

    # Join likes and dislikes.
    seen = [row["clothes_id"] for row in likes.data]
    seen += [row["clothes_id"] for row in dislikes.data]
    return seen


def _update_user_coordinates(user_id: str, pref_vec: np.ndarray) -> None:
    """
    DB function, takes a user's pref_vec and converts it to x, y coordinates and uploads it to db.
    """
    coords = Startup.umap_reducer.transform(pref_vec.reshape(1, -1))[0]
    _supabase_execute(supabase.table("Coordinates").upsert({
        "user_id": user_id,
        "x": float(coords[0]),
        "y": float(coords[1])
    }))

# --- Endpoints ---


@router.post("/swipe")
def swipe(req: SwipeData):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")
    
    """
    DB function. Takes a SwipeData object and updates the db with the relative information:
        - User's pref_vec.
        - User's Like/Dislike history.
    """
    # Get pref_vec of the user.
    pref_vec = _fetch_pref_vec(req.user_id)

    # Update the pref_vec of the user.
    pref_vec = _update_pref_vec(pref_vec, req.item_id, req.liked)

    # Save and upload the pref_vec to db.
    _save_pref_vec(req.user_id, pref_vec)

    # Save and upload the swipe data to the db.
    _record_swipe(req.user_id, req.item_id, req.liked)

    # Update coordinates every 4 swipes only.
    seen_count = len(_fetch_seen_item_ids(req.user_id))
    if seen_count % 4 == 0:
        try:
            BackgroundTasks.add_task(_update_user_coordinates, req.user_id, pref_vec)
        except Exception:
            pass

    # Return status to client.
    return {"status": "ok"}

@router.post("/recommendations")
def recommendations(req: RecommendationRequest) -> RecommendationResponse:

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")
    

    # Get pref_vec of the user.
    pref_vec = _fetch_pref_vec(req.user_id)

    # Get seen items of the user.
    seen_item_ids = _fetch_seen_item_ids(req.user_id)

    # If the pref_vec of a user is 0, get n random items from the db.
    if np.all(pref_vec == 0.0):
        random_ids = random.sample(Startup._item_ids, k=min(req.n, len(Startup._item_ids)))
        items = _fetch_clothing_items(random_ids)
        return RecommendationResponse(recommendations=items)

    # If user already has an existing pref_vec fetch n items and return it to client.
    results = get_recommendations(pref_vec, seen_item_ids, n=req.n)

    # Fetch the recommended items from the db.
    items = _fetch_clothing_items(results)

    # Send HTTP POST response to client.
    return RecommendationResponse(recommendations=items)

@router.post("/recommendations/debug")
def recommendations_debug(req: RecommendationRequest):

    # If the server is still warming up, return a 503 Service Unavailable error.
    if not Startup.ready:
        raise HTTPException(status_code=503, detail="Server still warming up, try again shortly")
    
    from services.recommendation_service import get_recommendations_with_scores
    pref_vec = _fetch_pref_vec(req.user_id)
    seen_item_ids = _fetch_seen_item_ids(req.user_id)
    results = get_recommendations_with_scores(pref_vec, seen_item_ids, n=req.n)
    return {"recommendations": [{"item_id": r[0], "score": r[1]} for r in results]}