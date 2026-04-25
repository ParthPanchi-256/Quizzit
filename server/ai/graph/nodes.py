"""
Graph nodes — each function is a step in the quiz generation pipeline.

Every node takes AgentState and returns a partial state update.
LLM calls go through the provider abstraction — no vendor imports here.
"""

from __future__ import annotations
import json
import traceback
from langchain_core.messages import HumanMessage, SystemMessage

from config import create_llm
from graph.state import AgentState
from schemas.quiz import ChatMessage, MessageRole, SessionPhase, GeneratedQuiz
from prompts.templates import (
    SYSTEM_PROMPT, ANALYZE_PROMPT, CLARIFY_TOPICS_PROMPT,
    CLARIFY_PREFS_PROMPT, SUGGEST_SEARCH_PROMPT,
    GENERATE_QUIZ_PROMPT, VERIFY_QUIZ_PROMPT, PARSE_USER_PREFS_PROMPT,
)
from tools.web_search import web_search


def _llm():
    """Get an LLM instance. Called per-node so it's always fresh."""
    return create_llm()


def _add_msg(state: AgentState, role: MessageRole, content: str,
             phase: SessionPhase | None = None, metadata: dict | None = None) -> list[ChatMessage]:
    """Append a message to the conversation history."""
    msgs = list(state.get("messages", []))
    msgs.append(ChatMessage(role=role, content=content, phase=phase, metadata=metadata))
    return msgs


def _invoke_llm(prompt: str, system: str = SYSTEM_PROMPT) -> str:
    """Invoke the LLM with a system + user prompt. Returns raw text."""
    llm = _llm()
    response = llm.invoke([
        SystemMessage(content=system),
        HumanMessage(content=prompt),
    ])
    return response.content


def _parse_json(text: str) -> dict:
    """Extract JSON from LLM response (handles markdown code blocks)."""
    text = text.strip()
    # Strip markdown code blocks
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (``` markers)
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)
    return json.loads(text)


# ══════════════════════════════════════════════════════════════
# Node: ANALYZE
# ══════════════════════════════════════════════════════════════

def analyze_content(state: AgentState) -> dict:
    """Analyze uploaded content to identify topics and depth."""
    content = state.get("raw_content", "")
    if not content.strip():
        return {
            "error": "No content provided. Please upload a file or enter a prompt.",
            "current_phase": "error",
            "messages": _add_msg(state, MessageRole.ASSISTANT,
                                 "I couldn't find any content to work with. Please upload a file or enter a prompt.",
                                 SessionPhase.ERROR),
        }

    # Truncate very long content for analysis (keep full for generation)
    analysis_content = content[:8000] if len(content) > 8000 else content
    prompt = ANALYZE_PROMPT.format(content=analysis_content)

    try:
        result = _parse_json(_invoke_llm(prompt))
    except (json.JSONDecodeError, Exception) as e:
        # Fallback: assume single topic
        result = {
            "topics": ["General"],
            "depth": "moderate",
            "estimated_questions": 10,
            "needs_search": False,
            "search_reason": "",
            "summary": "Content uploaded for quiz generation.",
        }

    msgs = _add_msg(state, MessageRole.ASSISTANT,
                     f"I've analyzed your content. Here's what I found:\n\n"
                     f"📝 **Summary:** {result['summary']}\n"
                     f"📚 **Topics:** {', '.join(result['topics'])}\n"
                     f"📊 **Depth:** {result['depth']}\n"
                     f"❓ **Can generate:** ~{result['estimated_questions']} questions",
                     SessionPhase.ANALYZING,
                     {"topics": result["topics"], "depth": result["depth"]})

    return {
        "topics": result["topics"],
        "depth": result["depth"],
        "estimated_questions": result["estimated_questions"],
        "content_summary": result["summary"],
        "needs_search": result.get("needs_search", False),
        "search_reason": result.get("search_reason", ""),
        "current_phase": "analyzed",
        "messages": msgs,
    }


# ══════════════════════════════════════════════════════════════
# Node: CLARIFY (topics + preferences in one step)
# ══════════════════════════════════════════════════════════════

def clarify(state: AgentState) -> dict:
    """Ask clarification questions about topics and preferences."""
    topics = state.get("topics", [])
    depth = state.get("depth", "moderate")
    summary = state.get("content_summary", "")
    user_resp = state.get("user_response")

    # If user already responded, parse their preferences
    if user_resp:
        return _parse_preferences(state, user_resp)

    # First time: build the clarification message
    if len(topics) > 1:
        topic_list = "\n".join(f"  {i+1}. **{t}**" for i, t in enumerate(topics))
        msg = (f"I found multiple topics in your content:\n{topic_list}\n\n"
               f"Would you like to focus on a specific topic, or cover **all** of them?\n\n"
               f"Also, tell me your preferences:\n"
               f"• **Number of questions** (I can generate up to ~{state.get('estimated_questions', 10)})\n"
               f"• **Question types** — single choice, multiple choice, fill-in-the-blank, or a mix?\n"
               f"• **Difficulty** — easy, medium, hard, or mixed?\n\n"
               f"💡 *Example: \"Focus on {topics[0]}, 10 questions, mixed types, medium difficulty\"*")
    else:
        topic = topics[0] if topics else "the content"
        msg = (f"Great content on **{topic}**! Let me know your preferences:\n\n"
               f"• **Number of questions** (up to ~{state.get('estimated_questions', 10)})\n"
               f"• **Question types** — single choice, multiple choice, fill-in-the-blank, or a mix?\n"
               f"• **Difficulty** — easy, medium, hard, or mixed?\n\n"
               f"💡 *Example: \"10 questions, mostly single choice, medium difficulty\"*")

    return {
        "current_phase": "clarifying",
        "waiting_for_input": True,
        "messages": _add_msg(state, MessageRole.ASSISTANT, msg, SessionPhase.CLARIFYING),
    }


def _parse_preferences(state: AgentState, user_msg: str) -> dict:
    """Parse user preferences from their free-text response."""
    topics = state.get("topics", ["General"])
    depth = state.get("depth", "moderate")
    max_q = state.get("estimated_questions", 10)

    prompt = PARSE_USER_PREFS_PROMPT.format(
        message=user_msg,
        topics=json.dumps(topics),
        depth=depth,
        max_questions=max_q,
    )

    try:
        prefs = _parse_json(_invoke_llm(prompt))
    except (json.JSONDecodeError, Exception):
        prefs = {
            "focus": "all",
            "num_questions": min(10, max_q),
            "question_types": ["single", "multiple", "fill_blank"],
            "difficulty": "mixed",
            "time_per_question": 30,
            "wants_search": None,
        }

    # Cap questions at estimated max
    num_q = min(prefs.get("num_questions", 10), max(max_q, 5))

    # Confirmation message
    focus = prefs.get("focus", "all")
    qtypes = ", ".join(prefs.get("question_types", ["single"]))
    msg = (f"Got it! Here's the plan:\n\n"
           f"📌 **Focus:** {focus}\n"
           f"📝 **Questions:** {num_q}\n"
           f"🎯 **Types:** {qtypes}\n"
           f"⚡ **Difficulty:** {prefs.get('difficulty', 'mixed')}\n"
           f"⏱️ **Time/question:** {prefs.get('time_per_question', 30)}s")

    return {
        "focus": focus,
        "num_questions": num_q,
        "question_types": prefs.get("question_types", ["single"]),
        "difficulty": prefs.get("difficulty", "mixed"),
        "time_per_question": prefs.get("time_per_question", 30),
        "wants_search": prefs.get("wants_search"),
        "current_phase": "preferences_set",
        "waiting_for_input": False,
        "user_response": None,  # Consume the response
        "messages": _add_msg(state, MessageRole.ASSISTANT, msg, SessionPhase.CLARIFYING),
    }


# ══════════════════════════════════════════════════════════════
# Node: OFFER SEARCH (optional, only if content is thin)
# ══════════════════════════════════════════════════════════════

def offer_search(state: AgentState) -> dict:
    """Optionally offer web search if content is thin."""
    needs_search = state.get("needs_search", False)
    depth = state.get("depth", "moderate")
    wants = state.get("wants_search")
    user_resp = state.get("user_response")

    # User already answered the search question
    if user_resp is not None:
        answer = user_resp.lower().strip()
        yes = any(w in answer for w in ["yes", "yeah", "sure", "ok", "search", "please", "yep"])
        return {
            "wants_search": yes,
            "current_phase": "search_decided",
            "waiting_for_input": False,
            "user_response": None,
            "messages": _add_msg(
                state, MessageRole.ASSISTANT,
                "🔍 I'll search the web for more material!" if yes else "👍 No problem, I'll work with what we have!",
                SessionPhase.SEARCHING if yes else SessionPhase.GENERATING,
            ),
        }

    # User explicitly said they want/don't want search during prefs
    if wants is not None:
        return {
            "wants_search": wants,
            "current_phase": "search_decided",
            "waiting_for_input": False,
        }

    # Only offer search if content is thin
    if not needs_search or depth == "comprehensive":
        return {
            "wants_search": False,
            "current_phase": "search_decided",
            "waiting_for_input": False,
        }

    # Ask the user
    focus = state.get("focus", "the topic")
    reason = state.get("search_reason", "")
    msg = (f"Your content is a bit thin on **{focus}**. "
           f"Would you like me to search the web for additional material? "
           f"This is optional — I can generate the quiz with just what you've given me.")

    return {
        "current_phase": "offering_search",
        "waiting_for_input": True,
        "messages": _add_msg(state, MessageRole.ASSISTANT, msg, SessionPhase.CLARIFYING),
    }


# ══════════════════════════════════════════════════════════════
# Node: WEB SEARCH
# ══════════════════════════════════════════════════════════════

def do_web_search(state: AgentState) -> dict:
    """Perform web search to supplement content."""
    if not state.get("wants_search", False):
        return {"search_results": "", "current_phase": "search_done"}

    focus = state.get("focus", "the topic")
    topics = state.get("topics", [])
    query = f"{focus} key concepts facts" if focus != "all" else " ".join(topics[:3]) + " key concepts"

    msgs = _add_msg(state, MessageRole.ASSISTANT,
                     f"🔍 Searching the web for *\"{query}\"*...",
                     SessionPhase.SEARCHING)

    try:
        results = web_search(query, max_results=5)
    except Exception as e:
        results = f"Search failed: {str(e)}"

    return {
        "search_results": results,
        "current_phase": "search_done",
        "messages": _add_msg(
            {**state, "messages": msgs}, MessageRole.ASSISTANT,
            f"Found supplementary material! Now generating your quiz...",
            SessionPhase.GENERATING,
        ),
    }


# ══════════════════════════════════════════════════════════════
# Node: GENERATE QUIZ
# ══════════════════════════════════════════════════════════════

def generate_quiz(state: AgentState) -> dict:
    """Generate the quiz using the LLM."""
    content = state.get("raw_content", "")
    search_results = state.get("search_results", "")
    focus = state.get("focus", "all")
    num_q = state.get("num_questions", 10)
    qtypes = state.get("question_types", ["single"])
    difficulty = state.get("difficulty", "mixed")
    time_per_q = state.get("time_per_question", 30)
    attempts = state.get("generation_attempts", 0)

    search_supplement = ""
    if search_results:
        search_supplement = f"**Supplementary Web Research:**\n{search_results}"

    prompt = GENERATE_QUIZ_PROMPT.format(
        content=content[:12000],  # Cap content to avoid token limits
        search_supplement=search_supplement,
        focus=focus,
        num_questions=num_q,
        question_types=", ".join(qtypes),
        difficulty=difficulty,
        time_per_question=time_per_q,
    )

    msgs = _add_msg(state, MessageRole.ASSISTANT,
                     f"⚙️ Generating {num_q} questions... This may take a moment.",
                     SessionPhase.GENERATING)

    try:
        raw = _invoke_llm(prompt)
        quiz_data = _parse_json(raw)
        quiz = GeneratedQuiz(**quiz_data)
    except json.JSONDecodeError:
        if attempts < 2:
            return {
                "generation_attempts": attempts + 1,
                "current_phase": "generating",
                "messages": _add_msg(
                    {**state, "messages": msgs}, MessageRole.ASSISTANT,
                    "⚠️ Had trouble formatting the quiz. Retrying...",
                    SessionPhase.GENERATING,
                ),
            }
        return {
            "error": "Failed to generate quiz after multiple attempts.",
            "current_phase": "error",
            "messages": _add_msg(
                {**state, "messages": msgs}, MessageRole.ASSISTANT,
                "❌ I had trouble generating the quiz. Please try again with different parameters.",
                SessionPhase.ERROR,
            ),
        }
    except Exception as e:
        return {
            "error": str(e),
            "current_phase": "error",
            "messages": _add_msg(
                {**state, "messages": msgs}, MessageRole.ASSISTANT,
                f"❌ Error generating quiz: {str(e)}",
                SessionPhase.ERROR,
            ),
        }

    return {
        "quiz": quiz,
        "generation_attempts": attempts + 1,
        "current_phase": "generated",
        "messages": _add_msg(
            {**state, "messages": msgs}, MessageRole.ASSISTANT,
            f"✅ Generated **{len(quiz.questions)}** questions! Now verifying quality...",
            SessionPhase.VERIFYING,
        ),
    }


# ══════════════════════════════════════════════════════════════
# Node: VERIFY QUIZ
# ══════════════════════════════════════════════════════════════

def verify_quiz(state: AgentState) -> dict:
    """Self-check the generated quiz for quality issues."""
    quiz = state.get("quiz")
    if not quiz:
        return {"current_phase": "error", "error": "No quiz to verify."}

    quiz_json = quiz.model_dump_json(indent=2)
    prompt = VERIFY_QUIZ_PROMPT.format(quiz_json=quiz_json)

    try:
        result = _parse_json(_invoke_llm(prompt))
    except (json.JSONDecodeError, Exception):
        # If verification fails, assume it's fine
        result = {"is_valid": True, "issues": [], "suggestions": []}

    issues = result.get("issues", [])
    suggestions = result.get("suggestions", [])

    if result.get("is_valid", True) or state.get("generation_attempts", 0) >= 2:
        # Quiz is good or we've already retried
        q_count = len(quiz.questions)
        type_counts = {}
        for q in quiz.questions:
            t = q.questionType.value
            type_counts[t] = type_counts.get(t, 0) + 1
        type_summary = ", ".join(f"{v} {k}" for k, v in type_counts.items())

        msg = (f"✅ **Quiz Ready!**\n\n"
               f"📝 **{quiz.title}**\n"
               f"_{quiz.description}_\n\n"
               f"• **{q_count}** questions ({type_summary})\n"
               f"• **{quiz.timePerQuestion}s** per question\n\n"
               f"You can preview the questions below and then create the quiz in Quizzit!")

        if suggestions:
            msg += "\n\n💡 **Suggestions:** " + "; ".join(suggestions[:3])

        return {
            "verification_issues": [],
            "current_phase": "done",
            "waiting_for_input": False,
            "messages": _add_msg(state, MessageRole.ASSISTANT, msg, SessionPhase.DONE,
                                 {"quiz": quiz.model_dump()}),
        }
    else:
        # Issues found — retry generation
        return {
            "verification_issues": issues,
            "current_phase": "generating",  # Loop back to generate
            "messages": _add_msg(state, MessageRole.ASSISTANT,
                                 f"Found some issues: {'; '.join(issues[:3])}. Regenerating...",
                                 SessionPhase.GENERATING),
        }


# ══════════════════════════════════════════════════════════════
# Routing functions (conditional edges)
# ══════════════════════════════════════════════════════════════

def should_clarify_or_generate(state: AgentState) -> str:
    """After analysis, decide if we need to clarify or can go straight to generate."""
    if state.get("error"):
        return "error"
    return "clarify"


def after_clarify(state: AgentState) -> str:
    """After clarification, check if we need user input or can proceed."""
    if state.get("waiting_for_input"):
        return "wait"
    return "offer_search"


def after_offer_search(state: AgentState) -> str:
    """After offering search, check if user needs to respond."""
    if state.get("waiting_for_input"):
        return "wait"
    if state.get("wants_search"):
        return "search"
    return "generate"


def after_search(state: AgentState) -> str:
    """After search, go to generate."""
    return "generate"


def after_generate(state: AgentState) -> str:
    """After generation, verify or handle error."""
    if state.get("error"):
        return "error"
    return "verify"


def after_verify(state: AgentState) -> str:
    """After verification, either done or retry."""
    phase = state.get("current_phase", "")
    if phase == "done":
        return "done"
    if phase == "generating":
        return "regenerate"
    return "done"
