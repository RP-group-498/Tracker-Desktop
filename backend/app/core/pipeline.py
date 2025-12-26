"""Component pipeline orchestration."""

from typing import Dict, Any, List, Optional
from app.core.component_registry import ComponentRegistry


class Pipeline:
    """
    Orchestrates the execution of components in dependency order.

    Components declare their dependencies, and the pipeline ensures
    they run in the correct order, passing outputs between them.
    """

    def __init__(self):
        self.registry = ComponentRegistry.get_instance()

    def run(
        self,
        start_component: str,
        data: Dict[str, Any],
        stop_after: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Run the pipeline starting from a component.

        Args:
            start_component: The component to start with
            data: Initial input data
            stop_after: Optional component to stop after

        Returns:
            Accumulated results from all components
        """
        results: Dict[str, Any] = {"input": data}
        execution_order = self._resolve_order(start_component)

        for component_name in execution_order:
            component = self.registry.get(component_name)
            if not component:
                continue

            # Build input for this component
            component_input = self._build_input(component_name, data, results)

            # Execute component
            try:
                output = component.process(component_input)
                results[component_name] = output
            except Exception as e:
                results[f"{component_name}_error"] = str(e)
                print(f"[Pipeline] Error in {component_name}: {e}")

            if stop_after and component_name == stop_after:
                break

        return results

    def _resolve_order(self, start: str) -> List[str]:
        """
        Resolve component execution order based on dependencies.
        Uses topological sort.
        """
        visited = set()
        order = []

        def visit(name: str):
            if name in visited:
                return
            visited.add(name)

            component = self.registry.get(name)
            if component:
                for dep in component.dependencies:
                    visit(dep)
                order.append(name)

        visit(start)
        return order

    def _build_input(
        self,
        component_name: str,
        original_data: Dict[str, Any],
        results: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Build input for a component from original data and previous results."""
        component = self.registry.get(component_name)
        if not component:
            return original_data

        # Start with original data
        component_input = original_data.copy()

        # Add outputs from dependencies
        for dep in component.dependencies:
            if dep in results:
                component_input[dep] = results[dep]

        return component_input


# Global pipeline instance
pipeline = Pipeline()
