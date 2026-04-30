import logging
from datetime import datetime, timezone, timedelta

_logger = logging.getLogger(__name__)
_LK = timezone(timedelta(hours=5, minutes=30))


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


def get_effective_active_time_date(now_utc: datetime | None = None) -> tuple[str, datetime, datetime]:
    """Return the active-time date key and UTC day bounds used by the pipeline.

    Date selection rule:
      - Convert current UTC time to LK time (UTC+5:30)
      - Before 11:00 PM LK, use previous day
      - At/after 11:00 PM LK, use current day

    Returns:
      (today_str, start_dt_utc, end_dt_utc)
      where today_str is YYYY-MM-DD and start/end are UTC midnight bounds
      for the selected day.
    """
    now_utc = now_utc or datetime.now(timezone.utc)
    now_lk = now_utc.astimezone(_LK)
    effective_utc = now_utc - timedelta(days=1) if now_lk.hour < 23 else now_utc
    today = effective_utc.date()
    today_str = today.strftime("%Y-%m-%d")
    start_dt = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    end_dt = start_dt + timedelta(days=1)
    return today_str, start_dt, end_dt
