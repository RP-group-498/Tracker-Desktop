"""
Classification Component - Enhanced with ML

Provides three-layer classification architecture:
1. Rule-based classification (fast, high confidence)
2. ML-based classification (medium confidence, for uncertain cases)
3. Fallback to neutral (low confidence)

Classification Categories:
- academic: Related to studies, research, learning
- productivity: Work tools, coding, documentation
- neutral: Email, communication, general utilities
- non_academic: Entertainment, social media, gaming
"""

from typing import Any, Dict, List, Optional
import logging

from app.components.base import ComponentBase
from .schemas import ClassificationInput, ClassificationOutput


# Basic domain rules for stub implementation
ACADEMIC_DOMAINS = {
    # Educational TLDs
    ".edu", ".ac.uk", ".ac.jp", ".edu.au", ".edu.sg",
    # Research
    "scholar.google", "researchgate.net", "academia.edu",
    "arxiv.org", "pubmed.ncbi", "jstor.org", "ieee.org",
    "semanticscholar.org", "paperswithcode.com", "connectedpapers.com",
    # Research Publishers & Databases
    "springer.com", "sciencedirect.com", "wiley.com", "nature.com",
    "elsevier.com", "acm.org", "scopus.com", "frontiersin.org",
    "mdpi.com", "plos.org", "biomedcentral.com",
    "nih.gov", "ncbi.nlm.nih.gov",
    # Learning platforms
    "coursera.org", "edx.org", "khanacademy.org", "udemy.com",
    "udacity.com", "brilliant.org", "duolingo.com",
    "freecodecamp.org", "codecademy.com", "pluralsight.com",
    "datacamp.com", "kaggle.com", "skillshare.com",
    # Reference
    "wikipedia.org", "wikimedia.org", "britannica.com",
    "wolframalpha.com", "mathway.com", "symbolab.com",
    # University/LMS
    "canvas", "blackboard", "moodle",
    # Research Tools
    "zotero.org", "mendeley.com", "overleaf.com",
}

PRODUCTIVITY_DOMAINS = {
    # Development
    "github.com", "gitlab.com", "bitbucket.org",
    "stackoverflow.com", "stackexchange.com",
    # Developer Communities & Blogs
    "dev.to", "medium.com", "hashnode.dev", "hashnode.com",
    "developer.mozilla.org", "css-tricks.com",
    # Documentation
    "docs.google.com", "notion.so", "confluence",
    "readthedocs.io", "readthedocs.org",
    # Cloud/Office
    "drive.google.com", "office.com", "dropbox.com",
    # IDEs online
    "replit.com", "codepen.io", "codesandbox.io", "stackblitz.com",
    # Hosting/Deployment
    "vercel.com", "netlify.com", "heroku.com",
    # Package Managers
    "npmjs.com", "pypi.org", "packagist.org",
}

NON_ACADEMIC_DOMAINS = {
    # Social media
    "facebook.com", "twitter.com", "x.com", "instagram.com",
    "tiktok.com", "snapchat.com", "reddit.com",
    "linkedin.com", "pinterest.com", "tumblr.com", "threads.net",
    # Video entertainment
    "netflix.com", "hulu.com", "disneyplus.com", "twitch.tv",
    "primevideo.com", "dailymotion.com", "crunchyroll.com", "funimation.com",
    # Memes / Viral content
    "9gag.com", "buzzfeed.com", "imgur.com", "rumble.com",
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

# Idle activity classifications for user-reported offline activities
# Maps activity_id -> (category, confidence)
IDLE_ACTIVITY_CLASSIFICATIONS = {
    "reading_book":        ("academic",     0.90),
    "studying_notes":      ("academic",     0.95),
    "attending_lecture":    ("academic",     0.95),
    "research_library":    ("academic",     0.90),
    "writing_notes":       ("academic",     0.85),
    "break_relaxing":      ("non_academic", 0.90),
    "exercise_walk":       ("non_academic", 0.85),
    "eating_meal":         ("non_academic", 0.90),
    "personal_errands":    ("non_academic", 0.85),
    "social_conversation": ("neutral",      0.80),
}

# Keywords for classifying custom idle activity text
IDLE_ACADEMIC_KEYWORDS = {
    "study", "research", "read", "reading", "lecture", "class", "course",
    "homework", "assignment", "thesis", "paper", "exam", "review", "notes",
    "library", "textbook", "learn", "learning", "tutor", "seminar", "lab",
}

IDLE_NON_ACADEMIC_KEYWORDS = {
    "game", "gaming", "movie", "tv", "show", "nap", "sleep", "rest",
    "shopping", "cook", "cooking", "clean", "cleaning", "laundry",
    "exercise", "gym", "walk", "run", "eat", "lunch", "dinner", "breakfast",
    "relax", "break", "chill", "hang out", "play",
}


class ClassificationComponent(ComponentBase):
    """
    Enhanced Classification Component with ML Integration.

    Provides three-layer classification:
    1. Rule-based (domain/app matching) - high confidence (≥0.80)
    2. ML model (zero-shot) - medium confidence (≥0.55)
    3. Fallback (neutral) - low confidence (0.50)

    The ML layer uses facebook/bart-large-mnli for zero-shot classification,
    requiring no training data - a valid research approach for establishing
    baselines that can be improved through fine-tuning.
    """

    def __init__(self):
        self._initialized = False
        self._config: Dict[str, Any] = {}
        self._ml_classifier: Optional[Any] = None
        self._ml_enabled = False

        # Enhanced statistics tracking
        self._stats = {
            "total_classified": 0,
            "by_layer": {
                "rules": 0,
                "model": 0,
                "gemini": 0,
                "pending_ai": 0,
                "fallback": 0,
            },
            "by_category": {
                "academic": 0,
                "productivity": 0,
                "neutral": 0,
                "non_academic": 0,
            },
            "ml_stats": {
                "calls": 0,
                "successes": 0,
                "failures": 0,
                "avg_confidence": 0.0,
            },
            "gemini_stats": {
                "calls": 0,
                "successes": 0,
                "failures": 0,
            },
        }

    @property
    def name(self) -> str:
        return "classification"

    @property
    def version(self) -> str:
        if hasattr(self, '_gemini_classifier') and self._gemini_classifier:
            return "0.3.0-gemini"
        return "0.2.0-ml" if self._ml_enabled else "0.1.0-rules"

    @property
    def dependencies(self) -> List[str]:
        return []  # No dependencies - this is the first component

    def initialize(self, config: Dict[str, Any]) -> None:
        """
        Initialize the classification component with optional ML support.

        Args:
            config: Configuration dictionary, can include:
                - ml: ML configuration (enabled, model_type, etc.)
        """
        self._config = config

        # Initialize ML classifier if enabled
        ml_config = config.get("ml", {})
        self._ml_enabled = ml_config.get("enabled", False)

        if self._ml_enabled:
            try:
                from .ml_classifier import MLClassifier
                from .gemini_classifier import GeminiClassifier
                from .config import get_ml_config

                ml_settings = get_ml_config(ml_config)
                
                # Zero-shot ML
                model_config = ml_settings.get(ml_settings.get("model_type", "zero_shot"), {})
                self._ml_classifier = MLClassifier(model_config)
                
                # Gemini Fallback
                gemini_config = ml_settings.get("gemini", {})
                self._gemini_classifier = GeminiClassifier(gemini_config)

                # Lazy loading: don't initialize model here
                if not ml_settings.get("lazy_loading", True):
                    try:
                        self._ml_classifier.initialize()
                    except Exception as e:
                        logging.warning(f"[Classification] ML model eager init failed: {e}")
                    
                    try:
                        self._gemini_classifier.initialize()
                    except Exception as e:
                        logging.warning(f"[Classification] Gemini model eager init failed: {e}")
                    
                    logging.info("[Classification] ML and Gemini models loading attempt complete (eager)")
                else:
                    logging.info("[Classification] ML and Gemini models configured (lazy loading)")

            except Exception as e:
                logging.error(f"[Classification] Failed to initialize ML: {e}")
                self._ml_enabled = False

        self._initialized = True
        logging.info(f"[Classification] Component initialized (v{self.version})")
        logging.info(f"[Classification] ML Layer: {'Enabled' if self._ml_enabled else 'Disabled'}")
        logging.info(f"[Classification] Rules: {len(ACADEMIC_DOMAINS)} academic, "
                    f"{len(PRODUCTIVITY_DOMAINS)} productivity, "
                    f"{len(NON_ACADEMIC_DOMAINS)} non-academic domains")

    def process(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify a browsing or desktop activity using three-layer approach.

        Layer 1: Rule-based classification (fast, high confidence ≥0.80)
        Layer 2: ML classification (medium confidence ≥0.55, for uncertain cases)
        Layer 3: Fallback to neutral (low confidence = 0.50)

        Args:
            data: Activity data dictionary

        Returns:
            ClassificationOutput as dict with category, confidence, source, etc.
        """
        if not self._initialized:
            raise RuntimeError("Component not initialized")

        # Parse input
        try:
            input_data = ClassificationInput(**data)
        except Exception as e:
            # Fallback for malformed input
            return self._create_fallback_output(f"Parse error: {str(e)}")

        source = data.get("source", "browser")

        # LAYER 1: Rule-based classification
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

            # Apply rule-based classification
            category, confidence, matched_rule = self._classify_by_rules(domain, url, title)

            # Handle special contexts (YouTube, Google)
            if input_data.youtube_context:
                category, confidence = self._classify_youtube(input_data.youtube_context, category)

            if input_data.google_context:
                category, confidence = self._classify_google(input_data.google_context, category)

        # Determine which layer to use based on rule confidence
        if confidence >= 0.80:
            # LAYER 1: High confidence from rules - use directly
            source_type = "rules"
            self._stats["by_layer"]["rules"] += 1

        elif self._should_use_ml(confidence):
            # LAYER 2: Try ML classification for uncertain cases
            ml_result = self._classify_with_ml(
                url=data.get("url", ""),
                title=data.get("title", "") or data.get("window_title", ""),
                domain=data.get("domain", "")
            )

            if ml_result and ml_result["confidence"] >= 0.80:
                # ML provided good classification
                category = ml_result["category"]
                confidence = ml_result["confidence"]
                matched_rule = ml_result.get("explanation", "ml_classification")
                source_type = "model"
                self._stats["by_layer"]["model"] += 1
            else:
                # ML failed or low confidence - Mark as pending for batch Gemini classification
                category = "neutral"  # Temporary placeholder
                confidence = 0.40
                matched_rule = "Awaiting batch Gemini classification"
                source_type = "pending_ai"
                self._stats["by_layer"]["pending_ai"] += 1
        else:
            # No ML available, use rule result or pending_ai handling
            if confidence >= 0.50:
                source_type = "rules"
                self._stats["by_layer"]["rules"] += 1
            else:
                # Mark as pending for batch Gemini classification
                category = "neutral"  # Temporary placeholder
                confidence = 0.40
                matched_rule = "Awaiting batch Gemini classification"
                source_type = "pending_ai"
                self._stats["by_layer"]["pending_ai"] += 1

        # Update stats
        self._stats["total_classified"] += 1
        self._stats["by_category"][category] += 1

        output = ClassificationOutput(
            category=category,
            confidence=confidence,
            source=source_type,
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

    def classify_idle_activity(self, activity_id: str = None, custom_label: str = None) -> Dict[str, Any]:
        """
        Classify a user-reported idle/offline activity.

        For predefined activities, uses the IDLE_ACTIVITY_CLASSIFICATIONS mapping.
        For custom text, uses keyword matching with lower confidence.

        Args:
            activity_id: Predefined activity key (e.g. "reading_book")
            custom_label: User-entered text for custom activities

        Returns:
            Dict with category, confidence, source, matched_rule
        """
        # Predefined activity lookup
        if activity_id and activity_id in IDLE_ACTIVITY_CLASSIFICATIONS:
            category, confidence = IDLE_ACTIVITY_CLASSIFICATIONS[activity_id]
            self._stats["total_classified"] += 1
            self._stats["by_category"][category] += 1
            return {
                "category": category,
                "confidence": confidence,
                "source": "user",
                "matched_rule": f"idle_predefined:{activity_id}",
            }

        # Custom text classification via keyword matching
        if custom_label:
            label_lower = custom_label.lower()
            words = set(label_lower.split())

            # Check for academic keywords
            if words & IDLE_ACADEMIC_KEYWORDS:
                self._stats["total_classified"] += 1
                self._stats["by_category"]["academic"] += 1
                return {
                    "category": "academic",
                    "confidence": 0.70,
                    "source": "user",
                    "matched_rule": "idle_custom_academic_keywords",
                }

            # Check for non-academic keywords
            if words & IDLE_NON_ACADEMIC_KEYWORDS:
                self._stats["total_classified"] += 1
                self._stats["by_category"]["non_academic"] += 1
                return {
                    "category": "non_academic",
                    "confidence": 0.70,
                    "source": "user",
                    "matched_rule": "idle_custom_non_academic_keywords",
                }

            # Fallback for unknown custom text
            self._stats["total_classified"] += 1
            self._stats["by_category"]["neutral"] += 1
            return {
                "category": "neutral",
                "confidence": 0.50,
                "source": "user",
                "matched_rule": "idle_custom_unknown",
            }

        # No activity specified
        return {
            "category": "neutral",
            "confidence": 0.50,
            "source": "user",
            "matched_rule": "idle_no_activity",
        }

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

        # Default to neutral for unknown domains
        return "neutral", 0.50, None

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
            # Analyze search query for academic/productivity keywords
            query = context.get("query", "").lower()

            # Academic keywords
            academic_keywords = [
                "research", "paper", "study", "learn", "learning", "course", "tutorial",
                "education", "university", "scholar", "academic", "thesis", "journal",
                "lecture", "homework", "assignment", "exam", "textbook", "chapter",
                "definition", "explain", "theory", "formula", "equation", "solve",
                "science", "math", "physics", "chemistry", "biology", "history"
            ]

            # Productivity/work keywords
            productivity_keywords = [
                "code", "coding", "programming", "developer", "development",
                "documentation", "api", "github", "stackoverflow", "debug",
                "error", "function", "class", "method", "algorithm", "data structure",
                "software", "framework", "library", "package", "install", "deploy"
            ]

            # Check for academic keywords
            if query and any(keyword in query for keyword in academic_keywords):
                return "academic", 0.70

            # Check for productivity keywords
            if query and any(keyword in query for keyword in productivity_keywords):
                return "productivity", 0.70

            # Default to neutral for generic searches
            return "neutral", 0.55

        return current_category, 0.6

    def _should_use_ml(self, rule_confidence: float) -> bool:
        """
        Determine if ML layer should be invoked.

        Args:
            rule_confidence: Confidence from rule-based layer

        Returns:
            True if ML should be tried
        """
        if not self._ml_enabled or not self._ml_classifier:
            return False

        # Use ML for uncertain rule-based results
        return rule_confidence < 0.80

    def _classify_with_ml(self, url: str, title: str, domain: str) -> Optional[Dict]:
        """
        Classify using ML model.

        Args:
            url: Full URL
            title: Page or window title
            domain: Domain name

        Returns:
            ML classification result or None if failed
        """
        if not self._ml_classifier:
            return None

        # Lazy initialization
        if not self._ml_classifier._initialized:
            try:
                logging.info("[Classification] Loading ML model (first use)...")
                self._ml_classifier.initialize()
            except Exception as e:
                logging.error(f"[Classification] ML init failed: {e}")
                self._ml_enabled = False
                return None

        try:
            self._stats["ml_stats"]["calls"] += 1

            result = self._ml_classifier.classify(url, title, domain)

            if result:
                self._stats["ml_stats"]["successes"] += 1
                # Update rolling average confidence
                total = self._stats["ml_stats"]["successes"]
                current_avg = self._stats["ml_stats"]["avg_confidence"]
                new_avg = (current_avg * (total - 1) + result["confidence"]) / total
                self._stats["ml_stats"]["avg_confidence"] = new_avg
            else:
                self._stats["ml_stats"]["failures"] += 1

            return result

        except Exception as e:
            logging.error(f"[Classification] ML classification error: {e}")
            self._stats["ml_stats"]["failures"] += 1
            return None

    def _classify_with_gemini(self, url: str, title: str, domain: str) -> Optional[Dict]:
        """
        Classify using Gemini model fallback.

        Args:
            url: Full URL
            title: Page or window title
            domain: Domain name

        Returns:
            Gemini classification result or None if failed
        """
        if not hasattr(self, '_gemini_classifier') or not self._gemini_classifier:
            return None

        # Lazy initialization
        if not self._gemini_classifier._initialized:
            try:
                logging.info("[Classification] Loading Gemini model (first use)...")
                self._gemini_classifier.initialize()
            except Exception as e:
                logging.error(f"[Classification] Gemini init failed: {e}")
                return None

        try:
            self._stats["gemini_stats"]["calls"] += 1

            result = self._gemini_classifier.classify(url, title, domain)

            if result:
                self._stats["gemini_stats"]["successes"] += 1
            else:
                self._stats["gemini_stats"]["failures"] += 1

            return result

        except Exception as e:
            logging.error(f"[Classification] Gemini classification error: {e}")
            self._stats["gemini_stats"]["failures"] += 1
            return None

    def _create_fallback_output(self, reason: str) -> Dict[str, Any]:
        """
        Create fallback classification output.

        Args:
            reason: Reason for fallback

        Returns:
            ClassificationOutput dict
        """
        return ClassificationOutput(
            category="neutral",
            confidence=0.5,
            source="fallback",
            explanation=reason
        ).model_dump()

    def get_status(self) -> Dict[str, Any]:
        """
        Return component status with ML statistics.

        Returns:
            Dict with component status, stats, and ML information
        """
        comp_type = "rules_only"
        if hasattr(self, '_gemini_classifier') and self._gemini_classifier:
            comp_type = "enhanced_ml_and_gemini"
        elif self._ml_enabled:
            comp_type = "enhanced_ml"
            
        status = {
            "name": self.name,
            "version": self.version,
            "initialized": self._initialized,
            "type": comp_type,
            "model_loaded": self._ml_classifier._initialized if self._ml_classifier else False,
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

        # Add ML-specific status if enabled
        if self._ml_enabled:
            if self._ml_classifier:
                status["ml_status"] = self._ml_classifier.get_stats()
            if hasattr(self, '_gemini_classifier') and self._gemini_classifier:
                status["gemini_status"] = self._gemini_classifier.get_stats()

        return status

    def get_gemini_classifier(self) -> Optional[Any]:
        """Get the Gemini classifier instance for batch processing."""
        if hasattr(self, '_gemini_classifier'):
            return self._gemini_classifier
        return None
