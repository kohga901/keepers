from contextlib import asynccontextmanager
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import clothes, users
from services import Startup

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
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