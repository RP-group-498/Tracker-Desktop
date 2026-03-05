from dataclasses import dataclass
from datetime import datetime


@dataclass
class BehaviorRecord:
    session_start: datetime
    session_end: datetime
    category: str  # "academic" | "productivity" | "non-academic"
    time_spent_minutes: float
    app_switch_count: int    # 1 if app changed from previous record, else 0
    app_name: str
