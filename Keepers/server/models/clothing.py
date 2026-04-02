"""
models/clothing.py

Defines the ClothingItem database model for the Keepers app.

Each ClothingItem represents a piece of clothing that users can swipe on.
Items store metadata (category, brand, image URL) as well as a CLIP embedding
vector, which is indexed by FAISS to power similarity-based recommendations.

Relationships:
    - preferences: one-to-many with Preference (a clothing item can appear in many swipe records)
"""
