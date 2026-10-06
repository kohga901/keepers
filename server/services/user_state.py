"""
user_state.py

Keeps each active user's swipe history in memory so the swipe and
recommendation endpoints don't have to re-read Likes/Dislikes from Supabase on
every request. That used to be most of their latency.

A user's state is loaded from Supabase the first time they are seen and
reloaded once it is older than STATE_TTL, which is how changes made outside
this server (the app deletes likes directly) get picked up.

The state lives in this process only, so the server must run as a single worker.
"""

import threading
import time
from collections import OrderedDict

from db import supabase, supabase_fetch_all

# Seconds before a user's state is reloaded from Supabase.
STATE_TTL = 300

# Least recently used users are dropped beyond this, to bound memory.
MAX_USERS = 500

# Seconds a served item is assumed to still be waiting in the app's deck. After
# this it is forgotten (the app was probably closed) and can be recommended again.
SERVED_TTL = 600


class _UserState:
    def __init__(self):
        self.lock = threading.Lock()
        self.liked: set[int] = set()
        self.disliked: set[int] = set()
        # Items sent to the app that may still be sitting unswiped in its deck,
        # mapped to when they were sent.
        self.served: dict[int, float] = {}
        self.loaded_at: float | None = None


_states: OrderedDict[str, _UserState] = OrderedDict()
_states_lock = threading.Lock()


def _fetch_ids(table: str, user_id: str) -> set[int]:
    """DB function. Every clothes_id a user has in Likes or Dislikes."""
    query = lambda: supabase.table(table).select("clothes_id").eq("user_id", user_id).order("clothes_id")
    return {row["clothes_id"] for rows in supabase_fetch_all(query) for row in rows}


def _get(user_id: str) -> _UserState:
    with _states_lock:
        state = _states.get(user_id)
        if state is None:
            state = _states[user_id] = _UserState()
        _states.move_to_end(user_id)
        while len(_states) > MAX_USERS:
            _states.popitem(last=False)
        return state


def _ensure_loaded(state: _UserState, user_id: str) -> None:
    """Loads or refreshes a user's state from Supabase. Caller must hold state.lock."""
    now = time.monotonic()
    state.served = {i: t for i, t in state.served.items() if now - t < SERVED_TTL}

    if state.loaded_at is not None and now - state.loaded_at < STATE_TTL:
        return

    liked = _fetch_ids("Likes", user_id)
    disliked = _fetch_ids("Dislikes", user_id)

    state.liked = liked
    # If an item somehow ended up in both tables, treat it as liked.
    state.disliked = disliked - liked
    for item_id in liked | disliked:
        state.served.pop(item_id, None)
    state.loaded_at = time.monotonic()


def snapshot(user_id: str) -> tuple[list[int], list[int], set[int], int]:
    """
    Returns:
        (liked item_ids, disliked item_ids, item_ids to keep out of the next batch,
         number of served items the user hasn't swiped on yet)
    """
    state = _get(user_id)
    with state.lock:
        _ensure_loaded(state, user_id)
        excluded = state.liked | state.disliked | set(state.served)
        return list(state.liked), list(state.disliked), excluded, len(state.served)


def record_swipe(user_id: str, item_id: int, liked: bool) -> tuple[list[int], list[int], bool]:
    """
    Applies a swipe to the in-memory state. Call it after the swipe has been
    written to Supabase, so a reload can never miss it.

    Returns:
        (liked item_ids, disliked item_ids, whether the item was previously swiped the other way)
    """
    state = _get(user_id)
    with state.lock:
        _ensure_loaded(state, user_id)

        target, other = (state.liked, state.disliked) if liked else (state.disliked, state.liked)
        switched = item_id in other
        other.discard(item_id)
        target.add(item_id)
        state.served.pop(item_id, None)

        return list(state.liked), list(state.disliked), switched


def mark_served(user_id: str, item_ids: list[int]) -> None:
    state = _get(user_id)
    now = time.monotonic()
    with state.lock:
        state.served.update((item_id, now) for item_id in item_ids)
