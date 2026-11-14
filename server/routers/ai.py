"""Authenticated AI shopping lookup for the mobile and web apps."""
import logging

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from db import supabase, supabase_execute
from services import ai_lookup_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


class LookupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: int = Field(gt=0)
    max_results: int = Field(default=5, ge=1, le=8)


@router.post("/lookup")
def lookup(req: LookupRequest, authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail={"code": "unauthorized"})
    try:
        identity = supabase.auth.get_user(authorization[7:].strip())
    except Exception:
        raise HTTPException(401, detail={"code": "unauthorized"}) from None
    if not identity or not identity.user:
        raise HTTPException(401, detail={"code": "unauthorized"})

    try:
        rows = supabase_execute(supabase.table("Clothing")
                                .select("item_id,item_name,item_img")
                                .eq("item_id", req.item_id).limit(1)).data
        if not rows:
            raise HTTPException(404, detail={"code": "invalid_image"})
        return ai_lookup_service.lookup_item(identity.user.id, rows[0], req.max_results)
    except ai_lookup_service.LookupError as error:
        headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
        raise HTTPException(error.status, detail={"code": error.code}, headers=headers) from None
    except HTTPException:
        raise
    except Exception:
        # Provider exception text can contain credentials or request contents.
        log.error("AI lookup failed unexpectedly")
        raise HTTPException(502, detail={"code": "unknown"}) from None
