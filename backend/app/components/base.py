"""Base class for all research components."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List


class ComponentBase(ABC):
    """
    Base class all research components must inherit.

    Components are the building blocks of the procrastination detection system.
    Each component handles a specific part of the analysis pipeline:
    - Classification: Categorizes browsing activity
    - Procrastination: Detects procrastination patterns
    - Intervention: Triggers user interventions
    - Task Breakdown: Breaks tasks into manageable pieces

    Components can depend on other components and access them
    through the ComponentRegistry.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """
        Unique component identifier.

        Examples: 'classification', 'procrastination', 'intervention'
        """
        pass

    @property
    @abstractmethod
    def version(self) -> str:
        """
        Component version string.

        Use semantic versioning: 'major.minor.patch'
        Example: '1.0.0', '0.1.0-stub'
        """
        pass

    @property
    @abstractmethod
    def dependencies(self) -> List[str]:
        """
        Names of components this component depends on.

        Return an empty list if no dependencies.
        The pipeline will ensure dependencies run first.
        """
        pass

    @abstractmethod
    def initialize(self, config: Dict[str, Any]) -> None:
        """
        Called once on application startup.

        Load ML models, connect to external services,
        and perform any setup required.

        Args:
            config: Component-specific configuration dictionary
        """
        pass

    @abstractmethod
    def process(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main processing method.

        Receives input data and returns processed output.
        This is called for each unit of work (e.g., each activity event).

        Args:
            data: Input data dictionary

        Returns:
            Output data dictionary
        """
        pass

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        """
        Health check and status information.

        Returns information about the component's current state,
        including model version, initialization status, etc.

        Returns:
            Status dictionary with at least 'name', 'version', 'initialized'
        """
        pass
