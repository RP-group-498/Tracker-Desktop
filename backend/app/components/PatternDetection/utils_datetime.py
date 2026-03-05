import logging
from datetime import datetime, timezone

_logger = logging.getLogger(__name__)


def _coerce_datetime(val) -> "datetime | None":
    """Coerce val to a UTC-aware datetime, or return None if unparseable.

    Handles:
      - datetime already UTC-aware  → returned as-is
      - datetime naive (no tzinfo)  → assume UTC, attach tzinfo
      - "2026-03-04T10:00:00Z"      → replace Z, parse as UTC
      - "2026-03-04T10:00:00+00:00" → fromisoformat, already aware
      - "2026-03-04T10:00:00"       → naive ISO, treat as UTC
    """
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if isinstance(val, str):
        s = val.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(val.strip(), fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    _logger.warning("[Pipeline] Warning: could not coerce value to datetime: %r", val)
    return None
