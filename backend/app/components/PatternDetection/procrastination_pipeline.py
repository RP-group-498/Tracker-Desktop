"""
patternDetection/procrastination_pipeline.py
Backward-compatibility re-exports.

All logic has been split into focused modules:
  constants, types, utils_datetime, readers,
  active_time, procrast_patterns, scoring,
  active_prediction, procrast_pipeline

Existing code that imports from this module continues to work unchanged.
"""

from .constants import *
from .types import *
from .utils_datetime import *
from .readers import *
from .active_time import *
from .procrast_patterns import *
from .scoring import *
from .active_prediction import *
from .procrast_pipeline import run_analysis_pipeline
