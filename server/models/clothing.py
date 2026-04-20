"""
models/clothing.py

Defines the ClothingItem database model for the Keepers app.

Each ClothingItem represents a piece of clothing that users can swipe on.
Items store metadata (category, brand, image URL) as well as a CLIP embedding
vector, which is indexed by FAISS to power similarity-based recommendations.

Relationships:
    - preferences: one-to-many with Preference (a clothing item can appear in many swipe records)
"""
from sqlalchemy import Column, BigInteger, Text
from db import Base

class Clothing(Base):
    __tablename__ = "Clothing"

    item_id          = Column(BigInteger, primary_key=True)
    item_name        = Column(Text, nullable=False)
    item_price       = Column(Text, nullable=True)
    item_gender      = Column(Text, nullable=True)
    item_img         = Column(Text, nullable=True)
    item_web_listing = Column(Text, nullable=True)