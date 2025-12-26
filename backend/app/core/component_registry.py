"""Component registry for plugin system."""

from typing import Dict, Optional, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from app.components.base import ComponentBase


class ComponentRegistry:
    """
    Singleton registry for component discovery and invocation.

    All ML components register themselves here on startup.
    Components can call each other through this registry.
    """

    _instance: Optional["ComponentRegistry"] = None
    _components: Dict[str, "ComponentBase"] = {}

    def __new__(cls) -> "ComponentRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._components = {}
        return cls._instance

    @classmethod
    def get_instance(cls) -> "ComponentRegistry":
        """Get the singleton instance."""
        if cls._instance is None:
            cls._instance = ComponentRegistry()
        return cls._instance

    def register(self, component: "ComponentBase") -> None:
        """Register a component."""
        self._components[component.name] = component
        print(f"[Registry] Registered component: {component.name} v{component.version}")

    def unregister(self, name: str) -> None:
        """Unregister a component."""
        if name in self._components:
            del self._components[name]
            print(f"[Registry] Unregistered component: {name}")

    def get(self, name: str) -> Optional["ComponentBase"]:
        """Get a component by name."""
        return self._components.get(name)

    def get_all(self) -> Dict[str, "ComponentBase"]:
        """Get all registered components."""
        return self._components.copy()

    def call(self, component_name: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Invoke a component's process method by name.

        Args:
            component_name: The name of the component to call
            data: Input data for the component

        Returns:
            The component's output

        Raises:
            ValueError: If the component is not found
        """
        component = self.get(component_name)
        if not component:
            raise ValueError(f"Component '{component_name}' not found")
        return component.process(data)

    def get_all_status(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all registered components."""
        return {
            name: component.get_status()
            for name, component in self._components.items()
        }
