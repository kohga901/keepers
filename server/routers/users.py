"""
routers/users.py
users.py is authentiction
Defines the API routes for user-related operations in the Keepers app.

Handles user registration, login, and profile retrieval. Authentication is
managed via JWT tokens. This router delegates business logic to the users
service layer and interacts with the User model.

Endpoints (to be implemented):
    - POST /users/register  — create a new user account
    - POST /users/login     — authenticate and return a JWT token
    - GET  /users/me        — retrieve the currently authenticated user's profile
"""

from fastapi import APIRouter

router = APIRouter()