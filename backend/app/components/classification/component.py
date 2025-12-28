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

# Desktop application classification rules
DESKTOP_PRODUCTIVITY_APPS = {
    # IDEs and Code Editors
    "code", "vscode", "visual studio code",
    "pycharm", "intellij", "webstorm", "phpstorm", "clion", "rider",
    "sublime text", "sublime_text", "atom", "brackets", "vim", "neovim", "emacs",
    "android studio", "xcode", "eclipse", "netbeans",
    # Office Applications
    "word", "winword", "excel", "powerpnt", "powerpoint", "onenote", "outlook",
    "libreoffice", "openoffice", "wps office",
    # Documentation/Notes
    "notion", "obsidian", "evernote", "typora", "marktext",
    # Design Tools
    "figma", "sketch", "adobe", "photoshop", "illustrator", "indesign", "xd",
    "canva", "gimp", "inkscape", "blender",
    # Development Tools
    "terminal", "cmd", "powershell", "windowsterminal", "iterm",
    "docker", "postman", "insomnia", "dbeaver", "datagrip",
    # Productivity
    "slack", "teams", "zoom", "webex",
    "trello", "asana", "jira", "linear",
    "calculator", "notepad",
}

DESKTOP_ACADEMIC_APPS = {
    # Reference Managers
    "zotero", "mendeley", "endnote", "jabref",
    # LaTeX Editors
    "texstudio", "texmaker", "overleaf", "lyx",
    # STEM Tools
    "matlab", "mathematica", "maple", "spss", "stata", "rstudio", "r",
    "jupyter", "anaconda", "spyder",
    # CAD/Science
    "autocad", "solidworks", "fusion", "chemsketch",
}

DESKTOP_NON_ACADEMIC_APPS = {
    # Games/Gaming
    "steam", "epicgameslauncher", "epic games", "origin", "uplay", "gog galaxy",
    "battle.net", "riot client", "valorant", "leagueoflegends",
    "minecraft", "roblox", "fortnite",
    # Media Players
    "vlc", "mpv", "mpc-hc", "potplayer", "kmplayer",
    "spotify", "itunes", "musicbee", "foobar2000",
    # Streaming Apps
    "netflix", "disney+", "hbo max", "prime video", "hulu",
    "twitch", "obs studio", "streamlabs",
    # Social/Chat (personal)
    "discord", "telegram", "whatsapp", "messenger", "signal",
    # Entertainment
    "kodi", "plex", "emby",
}

DESKTOP_NEUTRAL_APPS = {
    # Browsers (classified by content, not app)
    "chrome", "firefox", "edge", "msedge", "brave", "opera", "safari", "vivaldi",
    # File Managers
    "explorer", "finder", "files", "dolphin", "nautilus",
    # System Tools
    "settings", "control panel", "task manager", "activity monitor",
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
        Classify a browsing or desktop activity.

        Uses simple rule matching for the stub implementation.
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

        # Check if this is a desktop event
        source = data.get("source", "browser")
        if source == "desktop":
            # Desktop app classification
            app_name = data.get("app_name", "").lower()
            window_title = data.get("window_title", "").lower()
            category, confidence, matched_rule = self._classify_desktop_app(app_name, window_title)
        else:
            # Browser classification
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

    def _classify_desktop_app(self, app_name: str, window_title: str) -> tuple:
        """Classify desktop applications by app name and window title."""

        # Remove .exe extension if present
        app_name_clean = app_name.replace(".exe", "").strip()

        # Check academic apps first
        for pattern in DESKTOP_ACADEMIC_APPS:
            if pattern in app_name_clean:
                return "academic", 0.90, f"desktop_academic_app:{pattern}"

        # Check productivity apps
        for pattern in DESKTOP_PRODUCTIVITY_APPS:
            if pattern in app_name_clean:
                return "productivity", 0.85, f"desktop_productivity_app:{pattern}"

        # Check non-academic apps
        for pattern in DESKTOP_NON_ACADEMIC_APPS:
            if pattern in app_name_clean:
                return "non_academic", 0.85, f"desktop_non_academic_app:{pattern}"

        # Check neutral apps (browsers, file managers)
        for pattern in DESKTOP_NEUTRAL_APPS:
            if pattern in app_name_clean:
                return "neutral", 0.70, f"desktop_neutral_app:{pattern}"

        # Window title-based heuristics for unknown apps
        academic_keywords = ["lecture", "course", "study", "research", "thesis", "paper", "assignment"]
        if any(kw in window_title for kw in academic_keywords):
            return "academic", 0.65, "desktop_title_academic"

        productivity_keywords = ["document", "spreadsheet", "presentation", "project", "work", "meeting"]
        if any(kw in window_title for kw in productivity_keywords):
            return "productivity", 0.60, "desktop_title_productivity"

        entertainment_keywords = ["game", "play", "video", "movie", "music", "stream"]
        if any(kw in window_title for kw in entertainment_keywords):
            return "non_academic", 0.65, "desktop_title_entertainment"

        # Default to neutral for unknown apps
        return "neutral", 0.50, "desktop_unknown_app"

    def _classify_by_rules(self, domain: str, url: str, title: str) -> tuple:
        """Apply rule-based classification for browser events."""

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
                # Browser domain rules
                "browser_academic_patterns": len(ACADEMIC_DOMAINS),
                "browser_productivity_patterns": len(PRODUCTIVITY_DOMAINS),
                "browser_non_academic_patterns": len(NON_ACADEMIC_DOMAINS),
                # Desktop app rules
                "desktop_academic_apps": len(DESKTOP_ACADEMIC_APPS),
                "desktop_productivity_apps": len(DESKTOP_PRODUCTIVITY_APPS),
                "desktop_non_academic_apps": len(DESKTOP_NON_ACADEMIC_APPS),
                "desktop_neutral_apps": len(DESKTOP_NEUTRAL_APPS),
            },
        }
