from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import clothes, users
from dotenv import load_dotenv
load_dotenv()

# Initialize the FastAPI framework.
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add routers.
app.include_router(clothes.router)
app.include_router(users.router)