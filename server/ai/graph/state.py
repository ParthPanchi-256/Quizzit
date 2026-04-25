"""
LangGraph state schema — the single source of truth for agent state.

All data flowing through the graph lives here. The state is a TypedDict
that LangGraph checkpoints between node executions.
"""

from __future__ import annotations
from typing import TypedDict, Optional, Literal
from schemas.quiz import ChatMessage, GeneratedQuiz


class AgentState(TypedDict, total=False):
    """Full state of the quiz generation agent."""

    # ── Input ──
    raw_content: str             # Extracted text from uploaded files + prompt
    file_names: list[str]        # Names of uploaded files

    # ── Analysis ──
    topics: list[str]            # Detected topics
    depth: str                   # "surface", "moderate", "comprehensive"
    estimated_questions: int     # How many questions can be generated
    content_summary: str         # Brief summary of content
    needs_search: bool           # Whether web search would help
    search_reason: str           # Why search was suggested

    # ── User preferences ──
    focus: str                   # Topic focus ("all" or specific topic)
    num_questions: int           # Requested number of questions
    question_types: list[str]    # ["single", "multiple", "fill_blank"]
    difficulty: str              # "easy", "medium", "hard", "mixed"
    time_per_question: int       # Seconds
    wants_search: Optional[bool] # User's answer to search suggestion

    # ── Search results ──
    search_results: str          # Web search supplement text

    # ── Generated output ──
    quiz: Optional[GeneratedQuiz]  # The generated quiz
    verification_issues: list[str] # Issues found during verification
    generation_attempts: int       # How many times we've tried generating

    # ── Conversation ──
    messages: list[ChatMessage]  # Full chat history
    current_phase: str           # Current phase name
    waiting_for_input: bool      # Is the graph paused waiting for user?
    user_response: Optional[str] # Latest user message (consumed by nodes)

    # ── Control ──
    error: Optional[str]         # Error message if something went wrong
