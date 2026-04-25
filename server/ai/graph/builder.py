"""
LangGraph builder — constructs and compiles the quiz generation graph.

The graph implements this flow:
  ANALYZE → CLARIFY ←→ (user) → OFFER_SEARCH ←→ (user) → SEARCH? → GENERATE → VERIFY → DONE
                                                                         ↑         |
                                                                         └─────────┘ (retry)
"""

from __future__ import annotations
from langgraph.graph import StateGraph, END

from graph.state import AgentState
from graph.nodes import (
    analyze_content,
    clarify,
    offer_search,
    do_web_search,
    generate_quiz,
    verify_quiz,
    should_clarify_or_generate,
    after_clarify,
    after_offer_search,
    after_generate,
    after_verify,
)


def build_graph() -> StateGraph:
    """Build the quiz generation state graph.

    Returns a compiled graph ready for invocation.
    """
    graph = StateGraph(AgentState)

    # ── Add nodes ──
    graph.add_node("analyze", analyze_content)
    graph.add_node("clarify", clarify)
    graph.add_node("offer_search", offer_search)
    graph.add_node("web_search", do_web_search)
    graph.add_node("generate", generate_quiz)
    graph.add_node("verify", verify_quiz)

    # ── Entry point ──
    graph.set_entry_point("analyze")

    # ── Edges ──
    # After analysis → clarify (or error)
    graph.add_conditional_edges("analyze", should_clarify_or_generate, {
        "clarify": "clarify",
        "error": END,
    })

    # After clarify → wait for input OR proceed to offer search
    graph.add_conditional_edges("clarify", after_clarify, {
        "wait": END,            # Pause graph, wait for user input
        "offer_search": "offer_search",
    })

    # After offer_search → wait for input OR search OR generate
    graph.add_conditional_edges("offer_search", after_offer_search, {
        "wait": END,            # Pause graph, wait for user input
        "search": "web_search",
        "generate": "generate",
    })

    # After web_search → generate
    graph.add_edge("web_search", "generate")

    # After generate → verify or error
    graph.add_conditional_edges("generate", after_generate, {
        "verify": "verify",
        "error": END,
    })

    # After verify → done or retry
    graph.add_conditional_edges("verify", after_verify, {
        "done": END,
        "regenerate": "generate",
    })

    return graph.compile()


# Singleton compiled graph
_compiled_graph = None


def get_graph():
    """Get the compiled graph (singleton)."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph
