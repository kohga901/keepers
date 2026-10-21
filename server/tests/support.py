"""Local persistence boundary; all recommendation, cache and route code stays real."""
import copy
import os
from pathlib import Path
import random
import socket
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

os.environ.setdefault("OMP_NUM_THREADS", "1")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import faiss
import numpy as np


class MemoryStore:
    def __init__(self):
        self.reset()
        self.auth = SimpleNamespace(get_user=self.get_user)

    def reset(self):
        self.rows = {name: [] for name in (
            "Clothing", "Embeddings", "Likes", "Dislikes", "Tags", "Tagged_Clothing",
            "User_Preferences", "Coordinates", "Relabeled_Clothing",
        )}
        self.failure = None
        self.tokens = {"alice-token": "alice", "bob-token": "bob"}

    def get_user(self, token):
        return SimpleNamespace(user=SimpleNamespace(id=self.tokens[token]) if token in self.tokens else None)

    def table(self, name):
        return MemoryQuery(self, name)


class MemoryQuery:
    def __init__(self, store, table):
        self.store, self.table = store, table
        self.operation, self.payload = "select", None
        self.filters, self.orders = [], []
        self.start, self.stop = 0, None

    def select(self, columns, **kwargs):
        return self

    def eq(self, column, value):
        self.filters.append(lambda row: row.get(column) == value)
        return self

    def in_(self, column, values):
        self.filters.append(lambda row: row.get(column) in values)
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def limit(self, count):
        self.stop = self.start + count
        return self

    def range(self, start, end):
        self.start, self.stop = start, end + 1
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def insert(self, payload):
        self.operation, self.payload = "insert", payload
        return self

    def upsert(self, payload):
        self.operation, self.payload = "upsert", payload
        return self

    def execute(self):
        if self.store.failure == (self.table, self.operation):
            raise RuntimeError("fixture database unavailable")
        rows = self.store.rows[self.table]
        matches = lambda row: all(predicate(row) for predicate in self.filters)
        selected = [row for row in rows if matches(row)]
        if self.operation == "delete":
            rows[:] = [row for row in rows if not matches(row)]
        elif self.operation in ("insert", "upsert"):
            payload = self.payload if isinstance(self.payload, list) else [self.payload]
            for row in payload:
                if self.operation == "upsert":
                    keys = ("user_id", "clothes_id") if self.table in ("Likes", "Dislikes") else (
                        ("user_id",) if self.table in ("Coordinates", "User_Preferences") else (
                            ("clothes_id",) if self.table == "Relabeled_Clothing" else ("item_id",)))
                    rows[:] = [old for old in rows if not all(old.get(k) == row.get(k) for k in keys)]
                rows.append(copy.deepcopy(row))
            selected = payload
        for column, desc in reversed(self.orders):
            selected.sort(key=lambda row: row.get(column, 0), reverse=desc)
        return SimpleNamespace(data=copy.deepcopy(selected[self.start:self.stop]), count=len(selected))


store = MemoryStore()
# Importing db normally reads server/.env and constructs a real client. Suppress
# both at that boundary so a developer's credentials cannot enter these tests.
with patch("dotenv.load_dotenv", return_value=False), \
        patch.dict(os.environ, {"SUPABASE_URL": "https://offline.invalid", "SUPABASE_KEY": "offline-test-key"}), \
        patch("supabase.create_client", return_value=store):
    import db
    from services import Startup, user_state
    from services import recommendation_service as recommendations
    from routers import clothes, admin, relabel
    from main import app


def vector(*components):
    result = np.zeros(Startup.EMBEDDING_DIM, dtype=np.float32)
    result[:len(components)] = components
    return result


def catalog(vectors=None):
    if vectors is None:
        vectors = {1: vector(1), 2: vector(1), 3: vector(.8, .6),
                   4: vector(0, 1), 5: vector(-1), 6: vector(0, -1)}
    matrix = np.stack(list(vectors.values())).astype(np.float32)
    faiss.normalize_L2(matrix)
    Startup.index = faiss.IndexFlatIP(Startup.EMBEDDING_DIM)
    Startup.index.add(matrix)
    Startup._item_ids = list(vectors)
    Startup.item_id_to_embedding = dict(zip(vectors, matrix))
    Startup.catalog_mean = vector(0)
    Startup.duplicate_groups = Startup.find_duplicate_groups(Startup.index, matrix, list(vectors))
    Startup.item_coordinates = {1: (0, 0), 3: (10, 20), 4: (30, 40)}
    store.rows["Clothing"] = [dict(item_id=i, item_name=f"Piece {i}", item_price="$35",
                                    item_img=f"https://example.test/{i}.jpg", item_gender=None,
                                    item_web_listing=f"https://example.test/shop/{i}") for i in vectors]
    store.rows["Tags"] = [{"Tag": tag, "Category": category} for tag, category in (
        ("shirt", "garment"), ("pants", "garment"), ("black", "color"),
        ("white", "color"), ("unused", "color"))]
    store.rows["Tagged_Clothing"] = [{"clothes_id": i, "Tag": tag} for i, tags in {
        1: ["shirt", "black"], 2: ["shirt", "black"], 3: ["pants", "black"],
        4: ["shirt", "white"], 5: ["pants", "white"], 6: ["pants", "black"],
    }.items() if i in vectors for tag in tags]
    Startup.tag_category, Startup.item_tags, Startup.tag_items = Startup.build_tag_lookups(
        store.rows["Tags"], store.rows["Tagged_Clothing"])
    Startup.ready = True


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        original_connect = socket.socket.connect
        def local_only(sock, address):
            # Windows' asyncio socketpair uses a loopback connection internally.
            if isinstance(address, tuple) and address[0] in ("127.0.0.1", "::1"):
                return original_connect(sock, address)
            raise AssertionError("Tests must not use external network connections")
        patch.object(socket.socket, "connect", local_only).start()
        # A real retry would sleep; failure tests should finish immediately.
        patch.object(db.time, "sleep").start()
        patch.dict(os.environ, {"ENABLE_ADMIN_UPLOAD": "0"}).start()
        store.reset()
        user_state._states.clear()
        user_state._has_created_at = True
        self.random_state = random.getstate()
        self.addCleanup(random.setstate, self.random_state)
        random.seed(42)
        catalog()

    def react(self, table, user, *ids):
        store.rows[table].extend({"user_id": user, "clothes_id": i} for i in ids)

    def ids(self, table, user="alice"):
        return [row["clothes_id"] for row in store.rows[table] if row.get("user_id") == user]
