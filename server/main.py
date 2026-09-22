from contextlib import asynccontextmanager
from pathlib import Path
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from routers import admin, clothes, users
from services import Startup
import time
print(f"[{time.time()}] main.py: imports done, about to load app")

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[{time.time()}] lifespan: starting background thread")
    threading.Thread(target=Startup.initialize, daemon=True).start()
    print(f"[{time.time()}] lifespan: yielding, app should be live now")
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

print(f"[{time.time()}] main.py: fully loaded")