"""
Classification Component - Stub Implementation

This is a placeholder component that provides basic rule-based classification.
It will be replaced with the full ML-based classification system.

Classification Categories:
- academic: Related to studies, research, learning
- productivity: Work tools, coding, documentation
- neutral: Email, communication, general utilities
- non_academic: Entertainment, social media, gaming
"""

from typing import Any, Dict, List
import random

from app.components.base import ComponentBase
from .schemas import ClassificationInput, ClassificationOutput


# Basic domain rules for stub implementation
ACADEMIC_DOMAINS = {
    # Educational TLDs
    ".edu", ".ac.uk", ".ac.jp", ".edu.au", ".edu.sg",
    # Research
    "scholar.google", "researchgate.net", "academia.edu",
    "arxiv.org", "pubmed.ncbi", "jstor.org", "ieee.org",
    # Learning platforms
    "coursera.org", "edx.org", "khanacademy.org", "udemy.com",
    "udacity.com", "brilliant.org", "duolingo.com",
    # Reference
    "wikipedia.org", "wikimedia.org", "britannica.com",
    # University
    "canvas", "blackboard", "moodle",
}

PRODUCTIVITY_DOMAINS = {
    # Development
    "github.com", "gitlab.com", "bitbucket.org",
    "stackoverflow.com", "stackexchange.com",
    # Documentation
    "docs.google.com", "notion.so", "confluence",
    # Cloud/Office
    "drive.google.com", "office.com", "dropbox.com",
    # IDEs online
    "replit.com", "codepen.io", "codesandbox.io",
}

NON_ACADEMIC_DOMAINS = {
    # Social media
    "facebook.com", "twitter.com", "x.com", "instagram.com",
    "tiktok.com", "snapchat.com", "reddit.com",
    # Video entertainment
    "netflix.com", "hulu.com", "disneyplus.com", "twitch.tv",
    "primevideo.com",
    # Gaming
    "steampowered.com", "epicgames.com", "roblox.com",
    # Shopping
    "amazon.com", "ebay.com", "aliexpress.com",
}


class ClassificationComponent(ComponentBase):
    """
    Classification Component Stub.

    Provides basic rule-based classification for development and testing.
    Returns classifications based on domain matching.

    Future versions will implement:
    - ML model inference (Homepage2Vec, DistilBERT)
    - Local LLM classification (Ollama)
    - User feedback learning
    """

    def __init__(self):
        self._initialized = False
        self._config: Dict[str, Any] = {}
        self._stats = {
            "total_classified": 0,
            "by_category": {
                "academic": 0,
                "productivity": 0,
                "neutral": 0,
                "non_academic": 0,
            },
        }

    @property
    def name(self) -> str:
        return "classification"

    @property
    def version(self) -> str:
        return "0.1.0-stub"

    @property
    def dependencies(self) -> List[str]:
        return []  # No dependencies - this is the first component

    def initialize(self, config: Dict[str, Any]) -> None:
        """Initialize the stub classifier."""
        self._config = config
        self._initialized = True
        print(f"[Classification] Stub initialized (v{self.version})")
        print(f"[Classification] Rules: {len(ACADEMIC_DOMAINS)} academic, "
              f"{len(PRODUCTIVITY_DOMAINS)} productivity, "
              f"{len(NON_ACADEMIC_DOMAINS)} non-academic domains")

    def process(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify a browsing activity.

        Uses simple domain matching rules for the stub implementation.
        """
        if not self._initialized:
            raise RuntimeError("Component not initialized")

        # Parse input
        try:
            input_data = ClassificationInput(**data)
        except Exception as e:
            # Fallback for malformed input
            return ClassificationOutput(
                category="neutral",
                confidence=0.5,
                source="stub",
                explanation=f"Parse error: {str(e)}"
            ).model_dump()

        domain = input_data.domain.lower()
        url = input_data.url.lower()
        title = input_data.title.lower()

        # Check rules in priority order
        category, confidence, matched_rule = self._classify_by_rules(domain, url, title)

        # Handle special contexts
        if input_data.youtube_context:
            category, confidence = self._classify_youtube(input_data.youtube_context, category)

        if input_data.google_context:
            category, confidence = self._classify_google(input_data.google_context, category)

        # Update stats
        self._stats["total_classified"] += 1
        self._stats["by_category"][category] += 1

        output = ClassificationOutput(
            category=category,
            confidence=confidence,
            source="stub",
            matched_rule=matched_rule,
        )

        return output.model_dump()

    def _classify_by_rules(self, domain: str, url: str, title: str) -> tuple:
        """Apply rule-based classification."""

        # Check academic domains
        for pattern in ACADEMIC_DOMAINS:
            if pattern in domain or pattern in url:
                return "academic", 0.85, f"academic_domain:{pattern}"

        # Check productivity domains
        for pattern in PRODUCTIVITY_DOMAINS:
            if pattern in domain:
                return "productivity", 0.80, f"productivity_domain:{pattern}"

        # Check non-academic domains
        for pattern in NON_ACADEMIC_DOMAINS:
            if pattern in domain:
                return "non_academic", 0.85, f"non_academic_domain:{pattern}"

        # Check educational TLDs
        if any(domain.endswith(tld) for tld in [".edu", ".ac.uk", ".edu.au"]):
            return "academic", 0.90, "educational_tld"

        # Title-based heuristics
        academic_keywords = ["lecture", "course", "study", "research", "thesis", "paper"]
        if any(kw in title for kw in academic_keywords):
            return "academic", 0.65, "title_keywords"

        # Default to neutral with some randomness
        confidence = 0.5 + random.uniform(0, 0.15)
        return "neutral", confidence, None

    def _classify_youtube(self, context: dict, current_category: str) -> tuple:
        """Adjust classification for YouTube content."""
        if context.get("isSearch"):
            # YouTube search could be academic
            return "neutral", 0.6

        title = context.get("titleForClassification", "").lower()

        # Educational YouTube content
        edu_keywords = ["tutorial", "lecture", "course", "learn", "explained",
                        "how to", "education", "university", "professor"]
        if any(kw in title for kw in edu_keywords):
            return "academic", 0.70

        # Entertainment keywords
        entertainment_keywords = ["gameplay", "funny", "prank", "vlog", "reaction"]
        if any(kw in title for kw in entertainment_keywords):
            return "non_academic", 0.75

        # Default YouTube to non-academic (entertainment)
        return "non_academic", 0.60

    def _classify_google(self, context: dict, current_category: str) -> tuple:
        """Adjust classification for Google services."""
        if context.get("isScholar"):
            return "academic", 0.95

        if context.get("isClassroom"):
            return "academic", 0.90

        if context.get("isDocs") or context.get("isDrive"):
            return "productivity", 0.75

        if context.get("isSearch"):
            # Could be anything
            return "neutral", 0.55

        return current_category, 0.6

    def get_status(self) -> Dict[str, Any]:
        """Return component status."""
        return {
            "name": self.name,
            "version": self.version,
            "initialized": self._initialized,
            "type": "stub",
            "model_loaded": False,
            "stats": self._stats,
            "rules": {
                "academic_patterns": len(ACADEMIC_DOMAINS),
                "productivity_patterns": len(PRODUCTIVITY_DOMAINS),
                "non_academic_patterns": len(NON_ACADEMIC_DOMAINS),
            },
        }
