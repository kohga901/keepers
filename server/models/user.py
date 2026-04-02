"""
models/user.py

Defines the User database model for the Keepers app.

Each User represents a registered account. Users interact with clothing items
by swiping (like/dislike), which builds a preference vector used by the
CLIP + FAISS recommendation engine to personalise their feed.

Relationships:
    - preferences: one-to-many with Preference (a user has many swipe records)
"""
