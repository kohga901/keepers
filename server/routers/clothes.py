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


from db import supabase
from services.recommendation_service import get_recommendations
from services.Startup import EMBEDDING_DIM, item_id_to_embedding

router = APIRouter(prefix="/clothes")

ALPHA = 0.1
BETA  = 0.05


# --- Request / Response models ---

class SwipeData(BaseModel):
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
    response = supabase.table("User_Preferences").select("pref_vec").eq("user_id", user_id).execute()
    if not response.data or response.data[0]["pref_vec"] is None:
        return np.zeros(EMBEDDING_DIM, dtype=np.float32)
    return np.array(json.loads(response.data[0]["pref_vec"]), dtype=np.float32)
def _update_pref_vec(pref_vec: np.ndarray, item_id: str, liked: bool) -> np.ndarray:
    item_embedding = item_id_to_embedding.get(item_id)
    if item_embedding is None:
        return pref_vec
    if liked:
        pref_vec = pref_vec + ALPHA * item_embedding
    else:
        pref_vec = pref_vec - BETA * item_embedding
    norm = np.linalg.norm(pref_vec)
    if norm > 0.0:
        pref_vec = pref_vec / norm
    return pref_vec

def _save_pref_vec(user_id: str, pref_vec: np.ndarray) -> None:
    supabase.table("User_Preferences").upsert({
        "user_id": user_id,
        "pref_vec": pref_vec.tolist()
    }).execute()

def _record_swipe(user_id: str, item_id: str, liked: bool) -> None:
    table = "Likes" if liked else "Dislikes"
    supabase.table(table).upsert({
        "user_id": user_id,
        "clothes_id": int(item_id)
    }).execute()

def _fetch_seen_item_ids(user_id: str) -> list[str]:
    likes    = supabase.table("Likes").select("clothes_id").eq("user_id", user_id).execute()
    dislikes = supabase.table("Dislikes").select("clothes_id").eq("user_id", user_id).execute()
    seen = [str(row["clothes_id"]) for row in likes.data]
    seen += [str(row["clothes_id"]) for row in dislikes.data]
    return seen


# --- Endpoints ---

@router.post("/swipe")
def swipe(req: SwipeData):
    pref_vec = _fetch_pref_vec(req.user_id)
    pref_vec = _update_pref_vec(pref_vec, req.item_id, req.liked)
    _save_pref_vec(req.user_id, pref_vec)
    _record_swipe(req.user_id, req.item_id, req.liked)
    return {"status": "ok"}

@router.post("/recommendations")
def recommendations(req: RecommendationRequest) -> RecommendationResponse:
    pref_vec      = _fetch_pref_vec(req.user_id)
    seen_item_ids = _fetch_seen_item_ids(req.user_id)

    if np.all(pref_vec == 0.0):
        raise HTTPException(
            status_code=400,
            detail="No preference data yet. Swipe on some items first."
        )

    results = get_recommendations(pref_vec, seen_item_ids, n=req.n)
    return RecommendationResponse(recommendations=results)