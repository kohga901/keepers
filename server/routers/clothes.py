"""
routers/clothes.py

Defines the API routes for clothing-related operations in the Keepers app.

Handles fetching clothing items for the swipe feed, recording swipe actions
(like/dislike), and retrieving personalised recommendations. This router
delegates business logic to the clothes service layer, which coordinates
with the CLIP + FAISS recommendation engine.

Endpoints:
    - POST /clothes/swipe           — record a like or dislike swipe for a clothing item
    - GET  /clothes/recommendations — return personalised recommendations based on the user's preference vector
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np

from services.recommendation_service import get_recommendations
from services.Startup import EMBEDDING_DIM

router = APIRouter(prefix="/clothes")

ALPHA = 0.1     # step size for likes
BETA  = 0.05    # step size for dislikes

# --- Request / Response models ---

# Using BaseModel to desereliaze the jsons in the http requests and responses.
class SwipeRequest(BaseModel):
    user_id: str
    item_id: str
    liked: bool

class RecommendationRequest(BaseModel):
    user_id: str
    n: int = 10

class RecommendationResponse(BaseModel):
    recommendations: list[str]


# --- Helpers ---

def _fetch_pref_vec(user_id: str) -> np.ndarray:
    """
    Fetches a user's preference vector from the db.
    
    Args:
        - User's id.
    
    Returns:
        - User's preference vector.
    """
    # TODO: query preferences table in DB for this user_id
    # return np.array(row.pref_vec, dtype=np.float32)
    return np.zeros(EMBEDDING_DIM, dtype=np.float32)

def _update_pref_vec(pref_vec: np.ndarray, item_id: str, liked: bool) -> np.ndarray:
    """
    Updates a preference vector with given single item and liked status.

    Args:
        - A preference vector.
        - item id.
        - liked status.
    
    Returns:
        - Updated preference vector.

    """
    # TODO: fetch item embedding from index by item_id
    # item_embedding = _item_ids_to_embedding[item_id]
    item_embedding = np.zeros(EMBEDDING_DIM, dtype=np.float32)  # stub

    if liked:
        pref_vec = pref_vec + ALPHA * item_embedding
    else:
        pref_vec = pref_vec - BETA  * item_embedding

    # Normalize after update so magnitude stays at 1.0
    norm = np.linalg.norm(pref_vec)
    if norm > 0.0:
        pref_vec = pref_vec / norm

    return pref_vec

def _save_pref_vec(user_id: str, pref_vec: np.ndarray) -> None:
    """
    Upload a user's preference vector to the database.

    Args:
        - A preference vector.
        - User id.
    """
    # TODO: write updated pref_vec back to preferences table in DB
    pass

def _record_swipe(user_id: str, item_id: str, liked: bool) -> None:
    """
    Uploads a user's like or dislike on an item to the database.
    """
    # TODO: insert row into swipes table in DB
    pass

def _fetch_seen_item_ids(user_id: str) -> list[str]:
    # TODO: query swipes table for all item_ids this user has swiped on
    return []


# --- Endpoints ---

@router.post("/swipe")
def swipe(req: SwipeRequest):
    pref_vec = _fetch_pref_vec(req.user_id)
    pref_vec = _update_pref_vec(pref_vec, req.item_id, req.liked)
    _save_pref_vec(req.user_id, pref_vec)
    _record_swipe(req.user_id, req.item_id, req.liked)
    return {"status": "ok"}


@router.post("/recommendations")
def recommendations(req: RecommendationRequest) -> RecommendationResponse:
    pref_vec     = _fetch_pref_vec(req.user_id)
    seen_item_ids = _fetch_seen_item_ids(req.user_id)

    # Cold start — user has no preference vector yet
    if np.all(pref_vec == 0.0):
        raise HTTPException(
            status_code=400,
            detail="User has no preference vector yet. Swipe on some items first."
        )

    results = get_recommendations(pref_vec, seen_item_ids, n=req.n)
    return RecommendationResponse(recommendations=results)