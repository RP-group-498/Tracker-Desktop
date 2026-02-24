"""User ID management service.

Generates and persists a unique user identifier per machine.
This will be replaced by a proper login flow in the future.
"""

import uuid
from pathlib import Path

# Module-level singleton
_user_manager: "UserManager | None" = None


class UserManager:
    """Manages user identification.

    On first launch, generates a UUID v4 and stores it in a file.
    Subsequent launches read the existing ID from the file.
    """

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.user_id_file = data_dir / "user_id.txt"
        self._user_id: str | None = None

    def get_user_id(self) -> str:
        """Load existing user ID or create a new one."""
        if self._user_id is not None:
            return self._user_id

        if self.user_id_file.exists():
            stored_id = self.user_id_file.read_text(encoding="utf-8").strip()
            if stored_id:
                self._user_id = stored_id
                return self._user_id

        # Generate new user ID
        self._user_id = str(uuid.uuid4())
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.user_id_file.write_text(self._user_id, encoding="utf-8")
        print(f"[UserManager] Generated new user ID: {self._user_id}")
        return self._user_id


def init_user_manager(data_dir: Path) -> UserManager:
    """Initialize the global user manager singleton."""
    global _user_manager
    _user_manager = UserManager(data_dir)
    return _user_manager


def get_user_manager() -> UserManager | None:
    """Get the global user manager instance."""
    return _user_manager
