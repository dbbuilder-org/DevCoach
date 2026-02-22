# Import all models here so that Alembic's autogenerate can discover them.
from models.user import User  # noqa: F401
from models.session import DaySession, WorkBlock  # noqa: F401
from models.conversation import Conversation  # noqa: F401
from models.puzzle import PuzzleAttempt, Badge, CoachingProfile  # noqa: F401

__all__ = [
    "User",
    "DaySession",
    "WorkBlock",
    "Conversation",
    "PuzzleAttempt",
    "Badge",
    "CoachingProfile",
]
