"""
ML Classifier configuration.

Provides default configuration for ML-based classification layer.
"""

from typing import Dict, Any


DEFAULT_ML_CONFIG: Dict[str, Any] = {
    # ML Layer Control
    "enabled": True,  # Enable/disable ML layer globally
    "model_type": "zero_shot",  # "zero_shot" or "embeddings"

    # Zero-shot model configuration
    "zero_shot": {
        "model_name": "facebook/bart-large-mnli",
        "device": "cpu",  # "cpu" or "cuda" (if GPU available)
        "confidence_threshold": 0.55,  # Minimum confidence to accept ML result (lowered from 0.60 to reduce neutral classifications)
        "batch_size": 1,  # Batch size for inference (1 for real-time)
    },

    # Sentence embedding model configuration (alternative)
    "embeddings": {
        "model_name": "sentence-transformers/all-MiniLM-L6-v2",
        "device": "cpu",
        "similarity_threshold": 0.70,  # Minimum similarity for classification
    },

    # Performance settings
    "lazy_loading": True,  # Load model on first use (vs at startup)
    "cache_enabled": True,  # Enable in-memory caching
    "max_cache_size": 10000,  # Maximum cache entries

    # Logging and metrics
    "log_classifications": True,  # Log classification decisions
    "track_metrics": True,  # Track performance metrics
}


def get_ml_config(user_config: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Get ML configuration with optional user overrides.

    Args:
        user_config: User-provided configuration overrides

    Returns:
        Merged configuration dictionary

    Example:
        >>> config = get_ml_config({"enabled": False})
        >>> config["enabled"]
        False
    """
    config = DEFAULT_ML_CONFIG.copy()

    if user_config:
        # Deep merge user config
        for key, value in user_config.items():
            if key in config and isinstance(config[key], dict) and isinstance(value, dict):
                # Merge nested dicts
                config[key].update(value)
            else:
                # Direct override
                config[key] = value

    return config


def validate_ml_config(config: Dict[str, Any]) -> bool:
    """
    Validate ML configuration.

    Args:
        config: Configuration dictionary to validate

    Returns:
        True if valid, raises ValueError otherwise

    Raises:
        ValueError: If configuration is invalid
    """
    if not isinstance(config, dict):
        raise ValueError("Config must be a dictionary")

    # Check required keys
    if "enabled" not in config:
        raise ValueError("Config missing 'enabled' key")

    if config["enabled"]:
        if "model_type" not in config:
            raise ValueError("Config missing 'model_type' key")

        model_type = config["model_type"]
        if model_type not in ["zero_shot", "embeddings"]:
            raise ValueError(f"Invalid model_type: {model_type}")

        # Check model-specific config exists
        if model_type not in config:
            raise ValueError(f"Config missing '{model_type}' section")

    return True
