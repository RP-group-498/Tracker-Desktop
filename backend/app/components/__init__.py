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

    # Future components will be added here:
    # - ProcrastinationComponent
    # - InterventionComponent
    # - TaskBreakdownComponent

    print(f"[Components] Loaded {len(registry.get_all())} component(s)")
