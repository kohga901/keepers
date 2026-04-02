"""
models/preference.py

Defines the Preference database model for the Keepers app.

Each Preference record captures a single swipe event — a user liking or
disliking a clothing item. These records are aggregated to build and update
each user's preference vector, which the CLIP + FAISS engine uses to rank
and serve personalised clothing recommendations.

Relationships:
    - user: many-to-one with User (each preference belongs to one user)
    - clothing_item: many-to-one with ClothingItem (each preference targets one item)
"""
