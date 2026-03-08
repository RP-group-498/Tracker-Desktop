"""
ML-based classification using zero-shot learning.

Provides fallback classification for uncertain rule-based cases using
pre-trained natural language inference models.

Research Notes:
    This implementation uses zero-shot classification as a research-valid
    approach for activity classification without custom training data.

    Justification:
    - Zero-shot models (BART-MNLI) are pre-trained on natural language inference
    - No custom training data required (acceptable for time-constrained research)
    - Published approach in academic literature (Yin et al., 2019)
    - Transparency: All classification decisions logged for analysis
    - Baseline comparison: Rule-based layer provides comparison metrics

    Limitations:
    - May not match domain-specific custom model accuracy
    - Confidence scores may need calibration for specific use case
    - Performance dependent on quality of category descriptions

    Future Work:
    - Collect labeled data during study for custom model training
    - Compare zero-shot vs fine-tuned model performance
    - User feedback loop to improve category descriptions
"""

from typing import Dict, Optional, Tuple
import logging
from collections import OrderedDict


class LRUCache:
    """
    Simple Least Recently Used (LRU) cache implementation.

    Maintains a fixed-size cache with automatic eviction of least
    recently used entries when capacity is reached.
    """

    def __init__(self, max_size: int = 10000):
        """
        Initialize LRU cache.

        Args:
            max_size: Maximum number of entries to cache
        """
        self.cache = OrderedDict()
        self.max_size = max_size

    def get(self, key: str) -> Optional[Dict]:
        """
        Get value from cache.

        Args:
            key: Cache key

        Returns:
            Cached value or None if not found
        """
        if key in self.cache:
            # Move to end (most recent)
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def put(self, key: str, value: Dict) -> None:
        """
        Put value in cache.

        Args:
            key: Cache key
            value: Value to cache
        """
        if key in self.cache:
            # Update existing
            self.cache.move_to_end(key)
            self.cache[key] = value
        else:
            # Add new entry
            if len(self.cache) >= self.max_size:
                # Remove oldest (first item)
                self.cache.popitem(last=False)
            self.cache[key] = value

    def clear(self) -> None:
        """Clear all cache entries."""
        self.cache.clear()

    def __len__(self) -> int:
        """Return cache size."""
        return len(self.cache)


class MLClassifier:
    """
    Zero-shot classifier using facebook/bart-large-mnli.

    Classifies URL + title combinations into academic/productivity/
    neutral/non_academic categories without requiring training data.

    The classifier uses a pre-trained natural language inference model
    to compare input text against category descriptions and select the
    best match.

    Attributes:
        model_name: Hugging Face model identifier
        device: Computation device ('cpu' or 'cuda')
        confidence_threshold: Minimum confidence to accept result
        _classifier: Hugging Face pipeline (lazy loaded)
        _initialized: Whether model has been loaded
        _cache: LRU cache for results
    """

    def __init__(self, config: Dict):
        """
        Initialize ML classifier.

        Args:
            config: Configuration dictionary with keys:
                - model_name: Model to use
                - device: 'cpu' or 'cuda'
                - confidence_threshold: Minimum confidence (0.0-1.0)
                - batch_size: Inference batch size
        """
        self.model_name = config.get("model_name", "facebook/bart-large-mnli")
        self.device = config.get("device", "cpu")
        self.batch_size = config.get("batch_size", 1)
        self.confidence_threshold = config.get("confidence_threshold", 0.55)

        self._classifier = None
        self._initialized = False
        self._cache = LRUCache(max_size=10000)

        # Category descriptions for zero-shot classification
        # These natural language descriptions define what each category means
        self.category_labels = {
            "academic": "academic research, studying, education, learning, university courses, scientific papers",
            "productivity": "work, coding, software development, documentation, professional tools, project management",
            "neutral": "email, communication, general web browsing, utilities, system tools",
            "non_academic": "entertainment, social media, gaming, shopping, leisure, streaming videos",
        }

        logging.info(f"[MLClassifier] Initialized with model: {self.model_name}")
        logging.info(f"[MLClassifier] Device: {self.device}")
        logging.info(f"[MLClassifier] Confidence threshold: {self.confidence_threshold}")

    def initialize(self) -> None:
        """
        Load the ML model (expensive operation).

        This is called lazily on first classification to avoid
        slow startup time. Model loading typically takes 15-30 seconds.

        Raises:
            Exception: If model fails to load
        """
        if self._initialized:
            return

        try:
            logging.info(f"[MLClassifier] Loading model: {self.model_name}")
            logging.info("[MLClassifier] This may take 15-30 seconds on first load...")

            from transformers import pipeline
            import torch

            # Determine device
            device = 0 if self.device == "cuda" and torch.cuda.is_available() else -1

            # Load zero-shot classification pipeline
            self._classifier = pipeline(
                "zero-shot-classification",
                model=self.model_name,
                device=device,
            )

            self._initialized = True
            logging.info("[MLClassifier] Model loaded successfully")

        except Exception as e:
            logging.error(f"[MLClassifier] Failed to load model: {e}")
            raise

    def classify(
        self, url: str, title: str, domain: str = ""
    ) -> Optional[Dict]:
        """
        Classify URL + title using zero-shot model.

        Args:
            url: Full URL of the webpage
            title: Page title or window title
            domain: Domain name (optional, extracted if not provided)

        Returns:
            Dict with classification result:
                {
                    "category": str,  # academic/productivity/neutral/non_academic
                    "confidence": float,  # 0.0-1.0
                    "source": "ml_model",
                    "explanation": str,  # Human-readable explanation
                    "model_name": str,  # Model used
                }

            Returns None if:
            - Model not initialized
            - Confidence below threshold
            - Classification fails

        Example:
            >>> classifier = MLClassifier(config)
            >>> classifier.initialize()
            >>> result = classifier.classify(
            ...     "https://arxiv.org/abs/1234",
            ...     "Machine Learning Paper"
            ... )
            >>> result["category"]
            'academic'
        """
        if not self._initialized:
            logging.warning("[MLClassifier] Model not initialized")
            return None

        # Build cache key
        cache_key = f"{domain}::{title[:50]}"
        cached_result = self._cache.get(cache_key)
        if cached_result is not None:
            logging.debug(f"[MLClassifier] Cache hit: {domain}")
            return cached_result

        # Prepare input text
        input_text = self._prepare_input(url, title, domain)

        if not input_text.strip():
            logging.warning("[MLClassifier] Empty input text")
            return None

        try:
            # Run zero-shot classification
            result = self._classifier(
                input_text,
                candidate_labels=list(self.category_labels.values()),
                multi_label=False,  # Single category per classification
            )

            # Extract best prediction
            best_label = result["labels"][0]
            best_score = float(result["scores"][0])

            # Map label back to category
            category = self._map_label_to_category(best_label)

            logging.debug(
                f"[MLClassifier] {domain} -> {category} "
                f"(confidence: {best_score:.2f})"
            )

            # Check confidence threshold
            if best_score < self.confidence_threshold:
                logging.debug(
                    f"[MLClassifier] Confidence {best_score:.2f} below "
                    f"threshold {self.confidence_threshold}"
                )
                return None

            # Build output
            output = {
                "category": category,
                "confidence": best_score,
                "source": "model",
                "explanation": f"Zero-shot: {best_label[:30]}...",
                "model_name": self.model_name,
            }

            # Cache result
            self._cache.put(cache_key, output)

            return output

        except Exception as e:
            logging.error(f"[MLClassifier] Classification failed: {e}")
            return None

    def _prepare_input(self, url: str, title: str, domain: str) -> str:
        """
        Prepare input text for classification.

        Combines domain, title, and URL into a natural language string
        that the model can understand.

        Args:
            url: Full URL
            title: Page or window title
            domain: Domain name

        Returns:
            Formatted input text

        Example:
            >>> classifier._prepare_input(
            ...     "https://github.com/user/repo",
            ...     "Code Repository",
            ...     "github.com"
            ... )
            'Website: github.com | Page: Code Repository'
        """
        parts = []

        if domain:
            parts.append(f"Website: {domain}")
        if title:
            parts.append(f"Page: {title}")
        if url and not domain:
            # Fallback to URL if no domain
            parts.append(f"URL: {url}")

        # Join parts and truncate to model max length
        text = " | ".join(parts)
        return text[:512]  # Most transformers have 512 token limit

    def _map_label_to_category(self, label: str) -> str:
        """
        Map zero-shot label back to category name.

        Args:
            label: Natural language label from model output

        Returns:
            Category name (academic/productivity/neutral/non_academic)

        Example:
            >>> classifier._map_label_to_category(
            ...     "academic research, studying, ..."
            ... )
            'academic'
        """
        for category, description in self.category_labels.items():
            if label == description:
                return category

        # Fallback (should not happen if labels are configured correctly)
        logging.warning(f"[MLClassifier] Unknown label: {label}, defaulting to neutral")
        return "neutral"

    def get_stats(self) -> Dict:
        """
        Return classifier statistics.

        Returns:
            Dict with statistics:
                {
                    "initialized": bool,
                    "model": str,
                    "device": str,
                    "cache_size": int,
                    "confidence_threshold": float,
                }
        """
        return {
            "initialized": self._initialized,
            "model": self.model_name,
            "device": self.device,
            "cache_size": len(self._cache),
            "max_cache_size": self._cache.max_size,
            "confidence_threshold": self.confidence_threshold,
        }

    def clear_cache(self) -> None:
        """Clear classification cache."""
        self._cache.clear()
        logging.info("[MLClassifier] Cache cleared")
