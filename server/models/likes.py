from sqlalchemy import Column, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from db import Base

class Like(Base):
    __tablename__ = "Likes"

    user_id    = Column(UUID(as_uuid=True), primary_key=True)
    clothes_id = Column(BigInteger, primary_key=True)