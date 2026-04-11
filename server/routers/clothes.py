"""
routers/clothes.py
Likes and dislikes here
Defines the API routes for clothing-related operations in the Keepers app.

Handles fetching clothing items for the swipe feed, recording swipe actions
(like/dislike), and retrieving personalised recommendations. This router
delegates business logic to the clothes service layer, which coordinates
with the CLIP + FAISS recommendation engine.

Endpoints (to be implemented):
    - GET  /clothes/feed            — return a batch of clothing items for the swipe feed
    - POST /clothes/swipe           — record a like or dislike swipe for a clothing item
    - GET  /clothes/recommendations — return personalised recommendations based on the user's preference vector
"""
