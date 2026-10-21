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

import logging
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager

from db import supabase, supabase_fetch_all
from services import Startup

log = logging.getLogger(__name__)

# Seconds before a user's state is reloaded from Supabase.
STATE_TTL = 300

# Least recently used users are dropped beyond this, to bound memory.
MAX_USERS = 500



class _UserState:
    def __init__(self):
        # Only one request at a time may read or change this user's state.
        # Re-entrant so a request can hold it across several calls (see user_lock).
        self.lock = threading.RLock()
        # item_ids in swipe order, oldest first. Dicts (values unused) rather than
        # sets so the order survives; compute_pref_vec weights recent swipes more.
        self.liked: dict[int, None] = {}
        self.disliked: dict[int, None] = {}
        # Every item the user has swiped on or been sent, plus every other copy of
        # the same product. It only ever grows, so a product is never recommended
        # twice, even after it is unliked.
        self.seen: set[int] = set()
        # Items that were sent while a tag filter was active. Swipes on these say little about
        # the user's taste outside the filter. Memory only: a restart forgets it.
        self.filtered: set[int] = set()
        # When the state was last loaded from Supabase. None means never.
        self.loaded_at: float | None = None


# user_id → state, least recently used first.
_states: OrderedDict[str, _UserState] = OrderedDict()

# Guards adding and removing users in _states.
_states_lock = threading.Lock()


# Set to False if Likes/Dislikes have no created_at column, so history loads unordered.
_has_created_at = True


def _with_duplicates(item_ids) -> set[int]:
    """
    The given item_ids plus every other item_id that is the same product as one of them.

    Example, if items 1 and 2 are the same product and 5 has no copies:
        _with_duplicates([1, 5])  →  {1, 2, 5}
    """
    # duplicates_of(item_id) is the set of every copy of that item, itself included. For an
    # item with no copies it is just (item_id,), so such items stay in the result unchanged.
    copies_of_each = map(Startup.duplicates_of, item_ids)

    # The * unpacks the copy-sets into separate arguments, so this reads as
    # set().union(copies_of_1, copies_of_5, ...). Starting from an empty set means an
    # empty item_ids gives an empty set instead of an error.
    return set().union(*copies_of_each)


def _fetch_ids(table: str, user_id: str) -> dict[int, None]:
    """DB function. Every clothes_id a user has in Likes or Dislikes, oldest swipe first."""
    global _has_created_at

    def query():
        # SELECT clothes_id FROM table WHERE user_id = user_id
        q = supabase.table(table).select("clothes_id").eq("user_id", user_id)

        # Oldest swipe first, if the table records when a swipe happened.
        if _has_created_at:
            q = q.order("created_at")
        # clothes_id breaks ties, and keeps paging stable without created_at.
        return q.order("clothes_id")

    try:
        # Fetch every page and keep the clothes_id's in order.
        return {row["clothes_id"]: None for rows in supabase_fetch_all(query) for row in rows}
    except Exception as e:
        # Any error that isn't about a missing created_at column is a real failure.
        if not _has_created_at or "created_at" not in str(e):
            raise
        log.warning("%s has no created_at column, so swipe recency is only known since this server started", table)

        # Remember the column is missing and fetch again without it.
        _has_created_at = False
        return _fetch_ids(table, user_id)


def _get(user_id: str) -> _UserState:
    with _states_lock:
        # Get the state of the user, creating it if this is their first request.
        state = _states.get(user_id)
        if state is None:
            state = _states[user_id] = _UserState()

        # Mark the user as the most recently used.
        _states.move_to_end(user_id)

        # Drop the least recently used users beyond the limit.
        while len(_states) > MAX_USERS:
            _states.popitem(last=False)
        return state


def _ensure_loaded(state: _UserState, user_id: str) -> None:
    """Loads or refreshes a user's state from Supabase. Caller must hold state.lock."""
    now = time.monotonic()

    # The state is fresh enough, so there is nothing to load.
    if state.loaded_at is not None and now - state.loaded_at < STATE_TTL:
        return

    # Fetch the likes and dislikes of the user.
    liked = _fetch_ids("Likes", user_id)
    disliked = _fetch_ids("Dislikes", user_id)

    state.liked = liked
    # If an item somehow ended up in both tables, treat it as liked.
    state.disliked = {i: None for i in disliked if i not in liked}

    # Everything swiped counts as seen. Nothing is ever removed from seen.
    state.seen.update(_with_duplicates(liked), _with_duplicates(disliked))

    # Record when the state was loaded.
    state.loaded_at = time.monotonic()


@contextmanager
def user_lock(user_id: str):
    """
    Holds a user's lock for the whole block, so nothing else can read or change
    their state in between. The recommendations endpoint uses it so two requests
    for the same user can't both pick the same items.
    """
    state = _get(user_id)
    with state.lock:
        yield


def snapshot(user_id: str) -> tuple[list[int], list[int], set[int]]:
    """
    Returns:
        (liked item_ids, disliked item_ids, item_ids to keep out of the next batch)
        Both item_id lists are ordered oldest swipe first.
    """
    state = _get(user_id)
    with state.lock:
        # Make sure the state of the user is loaded and fresh.
        _ensure_loaded(state, user_id)

        # Return copies so the caller can use them after the lock is released.
        return list(state.liked), list(state.disliked), set(state.seen)


def record_swipe(user_id: str, item_id: int, liked: bool) -> tuple[list[int], list[int], bool]:
    """
    Applies a swipe to the in-memory state. Call it after the swipe has been
    written to Supabase, so a reload can never miss it.

    Returns:
        (liked item_ids, disliked item_ids, whether the item was previously swiped the other way)
        Both item_id lists are ordered oldest swipe first.
    """
    state = _get(user_id)
    with state.lock:
        # Make sure the state of the user is loaded and fresh.
        _ensure_loaded(state, user_id)

        # The history the swipe goes into, and the opposite one.
        target, other = (state.liked, state.disliked) if liked else (state.disliked, state.liked)

        # Whether the item was swiped the other way before.
        switched = item_id in other

        # Remove the item from the opposite history.
        other.pop(item_id, None)
        # Re-insert so a repeat swipe moves the item to the newest end.
        target.pop(item_id, None)
        target[item_id] = None

        # A swiped item counts as seen, and so do its copies.
        state.seen.update(Startup.duplicates_of(item_id))

        return list(state.liked), list(state.disliked), switched


def remove_swipe(user_id: str, item_id: int, liked: bool) -> tuple[list[int], list[int]]:
    """
    Removes an item from a user's in-memory likes (liked=True) or dislikes
    (liked=False). Call it after the row has been deleted from Supabase.

    The item stays in `seen`, so it is not recommended again.

    Returns:
        (liked item_ids, disliked item_ids), both ordered oldest swipe first.
    """
    state = _get(user_id)
    with state.lock:
        # Make sure the state of the user is loaded and fresh.
        _ensure_loaded(state, user_id)

        # The history to remove the item from.
        target = state.liked if liked else state.disliked

        # Remove the item. Nothing happens if it wasn't there.
        target.pop(item_id, None)

        return list(state.liked), list(state.disliked)


def filtered_ids(user_id: str) -> frozenset[int]:
    """The items that were sent to the user while a tag filter was active."""
    state = _get(user_id)
    with state.lock:
        return frozenset(state.filtered)


def mark_served(user_id: str, item_ids: list[int], filtered: bool = False) -> None:
    """
    Records items as sent to the user, so they are never sent again.

    Args:
        filtered: whether a tag filter was active for this batch.
    """
    state = _get(user_id)
    with state.lock:
        if filtered:
            state.filtered.update(item_ids)

        # A sent item counts as seen, and so do its copies, so the product is never sent again.
        state.seen.update(_with_duplicates(item_ids))


def forget(user_id: str) -> None:
    """
    Drops a user's in-memory state, so their next request reloads it from Supabase.
    Call it after clearing their Likes/Dislikes, so cleared swipes stop counting
    and cleared items can be recommended again.
    """
    with _states_lock:
        _states.pop(user_id, None)
