"""Component plugin system."""

from typing import Dict, Any
from app.core.component_registry import ComponentRegistry


def load_all_components(config: Dict[str, Any]) -> None:
    """
    Initialize and register all components on startup.

    Args:
        config: Component configuration dictionary
    """
    from app.components.classification import ClassificationComponent

    registry = ComponentRegistry.get_instance()

    # Initialize and register classification component
    classification = ClassificationComponent()
    classification.initialize(config.get("classification", {}))
    registry.register(classification)

    # Task Prioritization component
    try:
        from app.components.task_prioritization import TaskPrioritizationComponent
        task_prio = TaskPrioritizationComponent()
        task_prio.initialize(config.get("task_prioritization", {}))
        registry.register(task_prio)
    except Exception as e:
        print(f"[Components] TaskPrioritizationComponent skipped: {e}")

    # Adaptive Time Estimator component
    try:
        from app.components.adaptive_time_estimator import AdaptiveTimeEstimatorComponent
        time_est = AdaptiveTimeEstimatorComponent()
        time_est.initialize(config.get("adaptive_time_estimator", {}))
        registry.register(time_est)
    except Exception as e:
        print(f"[Components] AdaptiveTimeEstimatorComponent skipped: {e}")

    print(f"[Components] Loaded {len(registry.get_all())} component(s)")
