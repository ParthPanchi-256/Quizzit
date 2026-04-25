"""
Web search tool — DuckDuckGo (no API key required).

Abstracted behind a Protocol so you can swap to Tavily, Serper,
or any other search provider by implementing the same interface.
"""

from __future__ import annotations
from typing import Protocol, runtime_checkable


@runtime_checkable
class SearchProvider(Protocol):
    """Any search provider that returns a list of result strings."""
    def search(self, query: str, max_results: int = 5) -> list[str]: ...


class DuckDuckGoSearch:
    """Free web search using duckduckgo-search. No API key needed."""

    def search(self, query: str, max_results: int = 5) -> list[str]:
        try:
            from duckduckgo_search import DDGS
            results = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=max_results):
                    title = r.get("title", "")
                    body = r.get("body", "")
                    href = r.get("href", "")
                    results.append(f"**{title}**\n{body}\nSource: {href}")
            return results
        except Exception as e:
            return [f"Search failed: {str(e)}"]


# ──────────────────────────────────────────────────────────────
# Factory — default to DuckDuckGo, easy to extend
# ──────────────────────────────────────────────────────────────

_search_instance: SearchProvider | None = None


def get_search_provider() -> SearchProvider:
    """Get the configured search provider (singleton)."""
    global _search_instance
    if _search_instance is None:
        _search_instance = DuckDuckGoSearch()
    return _search_instance


def web_search(query: str, max_results: int = 5) -> str:
    """Perform a web search and return formatted results.

    Args:
        query: Search query string
        max_results: Maximum number of results

    Returns:
        Formatted string of search results
    """
    provider = get_search_provider()
    results = provider.search(query, max_results)
    if not results:
        return "No search results found."
    return "\n\n---\n\n".join(results)
