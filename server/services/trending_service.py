"""
trending_service.py

Picks the one "trending" item that goes into each batch of the feed (see the
/clothes/recommendations endpoint).

Trending ranking:
    A product's score is the number of distinct users who liked it (or any copy of it, see
    Startup.duplicates_of) within the last `days` days. Ties go to the product liked most
    recently, then to the lower item_id so the order is stable. A product needs at least
    MIN_LIKES users to be on the list.

Picking the batch's trending item:
    Walk the ranking from the most liked down and take the first item that
        - is still in the catalog,
        - the user has not seen (swiped on or been sent, any copy of it),
        - is not blocked (e.g. already in the batch with its own badge),
        - passes the batch's tag filter, if there is one,
        - doesn't clash with the user's taste (see TASTE_KEEP_SHARE).
    If the shortest window in TRENDING_WINDOWS runs out, the next longer one is walked,
    so the slot is still filled when few people have swiped lately.

Database use:
    Supabase can't GROUP BY through the client, so the likes are fetched and counted here.
    One query (paged) reads the longest window, and every shorter window is counted from
    those same rows. The rankings are cached for CACHE_TTL seconds. After that the old
    rankings keep being served while one background thread refreshes them, so no feed
    request waits on Likes except the very first one after the server starts.
"""

import logging
import math
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import numpy as np

from db import supabase, supabase_fetch_all
from services import Startup

log = logging.getLogger(__name__)

# Windows (in days) to look for trending items in, tried in order. Most liked this week
# comes first; if all of those are seen, most liked this month, and so on.
TRENDING_WINDOWS = (7, 30, 90)

# A product needs at least this many distinct users liking it to count as trending,
# so a single like doesn't make an item trending.
MIN_LIKES = 2

# Most products one window's ranking keeps.
MAX_ITEMS = 200

# Taste check: a trending item must be among the nearest this share of the catalog to the
# user's pref_vec. 0.5 means it can't be in the half of the catalog furthest from their
# taste, so a goth-only user isn't shown a trending bikini, while popular items outside
# their usual style still get through. 1.0 turns the check off. Users with no likes are
# never checked, since they have no taste yet.
TASTE_KEEP_SHARE = 0.5

# The index and numpy round similarities slightly differently, so the item sitting exactly on the
# taste line can score a hair under its own line. This much slack keeps it in.
TASTE_TOLERANCE = 1e-5

# Seconds the rankings are used before they are refreshed from Likes.
CACHE_TTL = 300

# Seconds to wait before trying again after a failed fetch, so a Supabase outage doesn't
# make every feed request retry the query.
RETRY_AFTER = 30

# (time computed, {days: ranking}), or None before the first fetch. Guarded by _cache_lock.
_cache: tuple[float, dict[int, list[tuple[int, int]]]] | None = None
_cache_lock = threading.Lock()

# Held while the rankings are being fetched, so only one fetch runs at a time.
_refresh_lock = threading.Lock()


class TrendingPick(NamedTuple):
    item_id: int
    # Distinct users who liked the product in the window it was found in.
    like_count: int
    # The window, in days, the item was found in.
    days: int


def _parse_time(value) -> datetime | None:
    """A Supabase timestamp as a timezone-aware datetime, or None if it is missing or invalid."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    # A timestamp with no zone is taken as UTC, so it can be compared with the others.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _fetch_recent_likes(since: datetime) -> list[dict]:
    """DB function. Every like made at or after `since`, as {user_id, clothes_id, created_at} rows."""
    def query():
        # SELECT user_id, clothes_id, created_at FROM "Likes" WHERE created_at >= since
        return (supabase.table("Likes")
                .select("user_id, clothes_id, created_at")
                .gte("created_at", since.isoformat())
                # A stable order so pages don't overlap or skip rows.
                .order("created_at")
                .order("user_id")
                .order("clothes_id"))

    return [row for rows in supabase_fetch_all(query) for row in rows]


def rank(likes: list[dict], min_likes: int = MIN_LIKES, since: datetime | None = None) -> list[tuple[int, int]]:
    """
    Turns like rows into a trending ranking.

    Args:
        likes:     {user_id, clothes_id, created_at} rows.
        min_likes: distinct users a product needs to be ranked.
        since:     if given, only likes made at or after this time count.

    Returns:
        [(item_id, like_count), ...], most liked first, at most MAX_ITEMS. item_id is the copy
        of each product that was liked most, so the pick is the listing people are reacting to.
    """
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    # product → users who liked any copy of it.
    users: dict[frozenset[int] | tuple[int], set[str]] = defaultdict(set)
    # product → time of its latest like.
    latest: dict[frozenset[int] | tuple[int], datetime] = {}
    # item_id → users who liked that exact copy, to pick which copy to show.
    copy_users: dict[int, set[str]] = defaultdict(set)

    for row in likes:
        item_id, user_id = row.get("clothes_id"), row.get("user_id")
        if item_id is None or user_id is None:
            continue
        created = _parse_time(row.get("created_at"))
        if since is not None and (created is None or created < since):
            continue
        product = Startup.duplicates_of(item_id)
        users[product].add(user_id)
        copy_users[item_id].add(user_id)
        latest[product] = max(latest.get(product, oldest), created or oldest)

    ranking = []
    for product, likers in users.items():
        if len(likers) < min_likes:
            continue
        # Show the most liked copy, the lowest item_id on a tie.
        shown = min((i for i in product if i in copy_users), key=lambda i: (-len(copy_users[i]), i))
        ranking.append((shown, len(likers), latest[product]))

    # Most liked first, then most recently liked, then lowest item_id. Python's sort is
    # stable, so sorting by the least important key first leaves it as the tie-breaker.
    ranking.sort(key=lambda r: r[0])
    ranking.sort(key=lambda r: r[2], reverse=True)
    ranking.sort(key=lambda r: r[1], reverse=True)
    return [(item_id, count) for item_id, count, _ in ranking[:MAX_ITEMS]]


def _refresh() -> dict[int, list[tuple[int, int]]]:
    """DB function. Fetches the likes once and ranks every window from them, then caches the result."""
    global _cache
    now = datetime.now(timezone.utc)
    likes = _fetch_recent_likes(now - timedelta(days=max(TRENDING_WINDOWS)))
    rankings = {days: rank(likes, since=now - timedelta(days=days)) for days in TRENDING_WINDOWS}

    with _cache_lock:
        _cache = (time.monotonic(), rankings)

    log.info("trending refreshed likes=%d products=%s", len(likes),
             {days: len(r) for days, r in rankings.items()})
    return rankings


def _retry_later(rankings: dict[int, list[tuple[int, int]]]) -> None:
    """After a failed fetch: keep using `rankings`, and try again in RETRY_AFTER seconds."""
    global _cache
    with _cache_lock:
        # Backdate the entry so it goes stale RETRY_AFTER seconds from now.
        _cache = (time.monotonic() - CACHE_TTL + RETRY_AFTER, rankings)


def _refresh_in_background() -> None:
    """Refreshes the rankings, unless another refresh is already running. Never raises."""
    if not _refresh_lock.acquire(blocking=False):
        return
    try:
        _refresh()
    except Exception as e:
        log.warning("Could not refresh trending rankings: %r", e)
        # The old rankings stay in use until the retry.
        with _cache_lock:
            old = _cache[1] if _cache else {}
        _retry_later(old)
    finally:
        _refresh_lock.release()


def get_rankings() -> dict[int, list[tuple[int, int]]]:
    """
    {days: [(item_id, like_count), ...]} for every window in TRENDING_WINDOWS.

    Stale rankings are returned straight away while a background thread refreshes them.
    Only when there are none yet (just after startup) does this wait for the fetch.
    """
    with _cache_lock:
        cached = _cache

    if cached is not None:
        if time.monotonic() - cached[0] >= CACHE_TTL and not _refresh_lock.locked():
            threading.Thread(target=_refresh_in_background, daemon=True).start()
        return cached[1]

    # Nothing cached yet. Wait for whoever is fetching, or fetch now.
    with _refresh_lock:
        with _cache_lock:
            if _cache is not None:
                return _cache[1]
        try:
            return _refresh()
        except Exception:
            # No trending items until the retry, instead of every request waiting on Supabase.
            _retry_later({})
            raise


def clear_cache() -> None:
    """Drops the cached rankings, so the next request fetches them again."""
    global _cache
    with _cache_lock:
        _cache = None


def _taste_floor(pref: np.ndarray) -> float | None:
    """
    The lowest similarity to `pref` an item can have and still be among the nearest
    TASTE_KEEP_SHARE of the catalog, or None if the check is off.
    """
    if TASTE_KEEP_SHARE >= 1.0:
        return None
    with Startup._index_lock:
        total = Startup.index.ntotal
        if total == 0:
            return None
        keep = min(total, max(1, math.ceil(total * TASTE_KEEP_SHARE)))
        # The keep nearest items, nearest first; the last one sits on the line.
        scores, _ = Startup.index.search(pref.reshape(1, -1), k=keep)
    return float(scores[0][keep - 1])


def pick(
    pref_vec: np.ndarray,
    seen_ids: set[int],
    blocked_ids: set[int],
    allowed_ids: set[int] | None,
) -> TrendingPick | None:
    """
    The batch's trending item: the most liked item that passes every check in the
    module docstring, or None if no item does. Makes no database call except the
    first fetch after startup (see get_rankings).

    Args:
        pref_vec:    the user's preference vector. All 0 for a user with no likes, which
                     skips the taste check.
        seen_ids:    items the user has swiped on or been sent, with every copy included.
        blocked_ids: items that must not be picked, with every copy included.
        allowed_ids: the batch's tag filter, or None for no filter.
    """
    rankings = get_rankings()
    has_taste = bool(np.any(pref_vec))
    pref = np.asarray(pref_vec, dtype=np.float32)
    embeddings = Startup.item_id_to_embedding

    # Worked out on first use only, since most picks are decided by the first few items.
    floor: float | None = None
    floor_known = False

    # Products already looked at in a shorter window.
    checked: set[int] = set()

    for days in TRENDING_WINDOWS:
        for item_id, like_count in rankings.get(days, ()):
            if item_id in checked:
                continue
            copies = Startup.duplicates_of(item_id)
            checked.update(copies)

            # No longer in the catalog (deleted, or not embedded yet), so it can't be served.
            embedding = embeddings.get(item_id)
            if embedding is None:
                continue

            # Already seen or blocked, in any copy.
            if any(c in seen_ids or c in blocked_ids for c in copies):
                continue

            # Outside the tag filter.
            if allowed_ids is not None and item_id not in allowed_ids:
                continue

            # Too far from the user's taste.
            if has_taste:
                if not floor_known:
                    floor, floor_known = _taste_floor(pref), True
                if floor is not None and float(embedding @ pref) < floor - TASTE_TOLERANCE:
                    continue

            return TrendingPick(item_id, like_count, days)

    return None
