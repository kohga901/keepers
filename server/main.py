import os

# Must be set before torch/faiss/umap/scikit-learn get imported anywhere below
# (they each bundle their own copy of libomp.dylib on macOS). Two OpenMP
# runtimes fighting over the same thread pool is a known cause of hard
# SIGSEGV crashes — this env var tells OpenMP to tolerate the duplicate
# instead of corrupting its own thread-barrier state.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

from contextlib import asynccontextmanager
import logging
from pathlib import Path
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs a line for every Supabase call at INFO, which drowns out everything else.
logging.getLogger("httpx").setLevel(logging.WARNING)

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from routers import admin, clothes, users
from services import Startup

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs in the background so the port is bound before the index is built.
    threading.Thread(target=Startup.initialize, daemon=True).start()
    yield

# Initialize the FastAPI framework.
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add routers.
app.include_router(clothes.router)
app.include_router(users.router)
app.include_router(admin.router)

# Serves static/upload.html (the "Easy Upload" page) at /static/upload.html.
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")