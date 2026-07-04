"""
Quizzit AI Service — FastAPI application.

Session-based quiz generation using LangGraph.
Each session maintains its own graph state so conversations persist.
"""

from __future__ import annotations
import uuid
import time
import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx

from config import QUIZZIT_API_URL, MAX_UPLOAD_SIZE_MB, SESSION_TTL_MINUTES
from schemas.quiz import (
    SessionResponse, UserMessageRequest, FinalizeRequest,
    FinalizeResponse, ChatMessage, MessageRole, SessionPhase,
    GeneratedQuiz,
)
from graph.state import AgentState
from graph.builder import get_graph
from tools.file_parser import parse_file, SUPPORTED_EXTENSIONS


# ══════════════════════════════════════════════════════════════
# Session store — in-memory with TTL cleanup
# ══════════════════════════════════════════════════════════════

class Session:
    """Holds the graph state for one quiz generation conversation."""

    def __init__(self, session_id: str, initial_state: AgentState):
        self.id = session_id
        self.state: AgentState = initial_state
        self.created_at = time.time()
        self.last_active = time.time()

    def touch(self):
        self.last_active = time.time()

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.last_active) > (SESSION_TTL_MINUTES * 60)


_sessions: dict[str, Session] = {}


def _cleanup_sessions():
    """Remove expired sessions."""
    expired = [k for k, v in _sessions.items() if v.is_expired]
    for k in expired:
        del _sessions[k]


# ══════════════════════════════════════════════════════════════
# App lifecycle
# ══════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run session cleanup every 5 minutes."""
    async def cleanup_loop():
        while True:
            await asyncio.sleep(300)
            _cleanup_sessions()

    task = asyncio.create_task(cleanup_loop())
    yield
    task.cancel()


app = FastAPI(
    title="Quizzit AI",
    description="AI-powered quiz generation service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*","http://localhost:5173", "http://localhost:3000", "http://localhost:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════
# Helper: run graph step
# ══════════════════════════════════════════════════════════════

def _run_graph(state: AgentState) -> AgentState:
    """Run the graph from the current state until it pauses or finishes."""
    graph = get_graph()
    # Determine resume point based on current phase
    phase = state.get("current_phase", "")
    user_resp = state.get("user_response")

    if phase == "clarifying" and user_resp:
        result = graph.invoke(state, {"recursion_limit": 10})
    elif phase == "offering_search" and user_resp:
        result = graph.invoke(state, {"recursion_limit": 10})
    else:
        result = graph.invoke(state, {"recursion_limit": 10})

    return result


def _build_response(session: Session) -> SessionResponse:
    """Build the API response from session state."""
    state = session.state
    phase_str = state.get("current_phase", "uploading")
    try:
        phase = SessionPhase(phase_str)
    except ValueError:
        phase = SessionPhase.ANALYZING

    return SessionResponse(
        sessionId=session.id,
        phase=phase,
        messages=state.get("messages", []),
        quiz=state.get("quiz"),
        waitingForInput=state.get("waiting_for_input", False),
    )


# ══════════════════════════════════════════════════════════════
# Routes
# ══════════════════════════════════════════════════════════════

@app.post("/ai/sessions", response_model=SessionResponse)
async def create_session(
    files: list[UploadFile] = File(default=[]),
    prompt: Optional[str] = Form(default=None),
):
    """Create a new quiz generation session.

    Upload files (PDF, PPTX, TXT) and/or provide a text prompt.
    The AI will analyze the content and start asking questions.
    """
    _cleanup_sessions()

    # Parse all uploaded files
    content_parts: list[str] = []
    file_names: list[str] = []

    for f in files:
        if not f.filename:
            continue
        ext = "." + f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(400, f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")

        raw = await f.read()
        if len(raw) > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
            raise HTTPException(400, f"File '{f.filename}' exceeds {MAX_UPLOAD_SIZE_MB}MB limit.")

        try:
            text = parse_file(raw, f.filename)
            content_parts.append(f"=== File: {f.filename} ===\n{text}")
            file_names.append(f.filename)
        except ValueError as e:
            raise HTTPException(400, str(e))

    if prompt and prompt.strip():
        content_parts.append(f"=== User Prompt ===\n{prompt.strip()}")

    if not content_parts:
        raise HTTPException(400, "Please upload at least one file or provide a text prompt.")

    raw_content = "\n\n".join(content_parts)

    # Create session with initial state
    session_id = str(uuid.uuid4())
    initial_state: AgentState = {
        "raw_content": raw_content,
        "file_names": file_names,
        "topics": [],
        "depth": "",
        "estimated_questions": 0,
        "content_summary": "",
        "needs_search": False,
        "search_reason": "",
        "focus": "",
        "num_questions": 10,
        "question_types": ["single"],
        "difficulty": "mixed",
        "time_per_question": 30,
        "wants_search": None,
        "search_results": "",
        "quiz": None,
        "verification_issues": [],
        "generation_attempts": 0,
        "messages": [
            ChatMessage(
                role=MessageRole.ASSISTANT,
                content=f"📄 Received {'files: ' + ', '.join(file_names) if file_names else 'your prompt'}. Analyzing content...",
                phase=SessionPhase.ANALYZING,
            )
        ],
        "current_phase": "uploading",
        "waiting_for_input": False,
        "user_response": None,
        "error": None,
    }

    session = Session(session_id, initial_state)

    # Run the graph (analyze → clarify)
    try:
        result = _run_graph(initial_state)
        session.state = result
    except Exception as e:
        session.state["error"] = str(e)
        session.state["current_phase"] = "error"
        msgs = list(session.state.get("messages", []))
        msgs.append(ChatMessage(
            role=MessageRole.ASSISTANT,
            content=f"❌ Error during analysis: {str(e)}",
            phase=SessionPhase.ERROR,
        ))
        session.state["messages"] = msgs

    _sessions[session_id] = session
    return _build_response(session)


@app.post("/ai/sessions/{session_id}/message", response_model=SessionResponse)
async def send_message(session_id: str, req: UserMessageRequest):
    """Send a user message to an existing session.

    The AI will process the message and continue the conversation.
    """
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired.")
    if session.is_expired:
        del _sessions[session_id]
        raise HTTPException(410, "Session expired. Please start a new one.")

    session.touch()

    # Add user message to history
    msgs = list(session.state.get("messages", []))
    msgs.append(ChatMessage(role=MessageRole.USER, content=req.message))
    session.state["messages"] = msgs
    session.state["user_response"] = req.message
    session.state["waiting_for_input"] = False

    # Determine which node to resume from
    phase = session.state.get("current_phase", "")

    try:
        if phase in ("clarifying",):
            # Resume at clarify node
            from graph.nodes import clarify
            update = clarify(session.state)
            session.state.update(update)

            # If preferences are set, continue the pipeline
            if not session.state.get("waiting_for_input", False):
                from graph.nodes import offer_search, do_web_search, generate_quiz, verify_quiz

                # Offer search
                update = offer_search(session.state)
                session.state.update(update)

                # If not waiting for search answer, continue
                if not session.state.get("waiting_for_input", False):
                    if session.state.get("wants_search"):
                        update = do_web_search(session.state)
                        session.state.update(update)

                    update = generate_quiz(session.state)
                    session.state.update(update)

                    if not session.state.get("error"):
                        update = verify_quiz(session.state)
                        session.state.update(update)

                        # Retry if needed
                        if session.state.get("current_phase") == "generating":
                            update = generate_quiz(session.state)
                            session.state.update(update)
                            if not session.state.get("error"):
                                update = verify_quiz(session.state)
                                session.state.update(update)

        elif phase in ("offering_search",):
            # Resume at offer_search node
            from graph.nodes import offer_search, do_web_search, generate_quiz, verify_quiz

            update = offer_search(session.state)
            session.state.update(update)

            if not session.state.get("waiting_for_input", False):
                if session.state.get("wants_search"):
                    update = do_web_search(session.state)
                    session.state.update(update)

                update = generate_quiz(session.state)
                session.state.update(update)

                if not session.state.get("error"):
                    update = verify_quiz(session.state)
                    session.state.update(update)

        else:
            pass  # Phase doesn't expect input

    except Exception as e:
        session.state["error"] = str(e)
        session.state["current_phase"] = "error"
        msgs = list(session.state.get("messages", []))
        msgs.append(ChatMessage(
            role=MessageRole.ASSISTANT,
            content=f"❌ Error: {str(e)}",
            phase=SessionPhase.ERROR,
        ))
        session.state["messages"] = msgs

    return _build_response(session)


@app.get("/ai/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    """Get the current state of a session."""
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired.")
    return _build_response(session)


@app.post("/ai/sessions/{session_id}/finalize", response_model=FinalizeResponse)
async def finalize_session(session_id: str, req: FinalizeRequest):
    """Push the generated quiz to Quizzit's Node.js API.

    Requires the educator's JWT token to authenticate with the Quizzit API.
    """
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired.")

    quiz = session.state.get("quiz")
    if not quiz:
        raise HTTPException(400, "No quiz generated yet.")

    # Push to Quizzit API
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{QUIZZIT_API_URL}/quizzes/ai-import",
                json=quiz.model_dump(),
                headers={
                    "Authorization": f"Bearer {req.quizzitToken}",
                    "Content-Type": "application/json",
                },
                timeout=30.0,
            )
            if response.status_code != 201:
                error_data = response.json()
                return FinalizeResponse(
                    success=False,
                    message=error_data.get("error", "Failed to create quiz"),
                )

            data = response.json()
            # Clean up session
            del _sessions[session_id]
            return FinalizeResponse(
                success=True,
                quizId=data.get("quiz", {}).get("id"),
                message="Quiz created successfully!",
            )
    except Exception as e:
        return FinalizeResponse(success=False, message=f"Failed to push quiz: {str(e)}")


@app.delete("/ai/sessions/{session_id}")
async def delete_session(session_id: str):
    """Cancel and clean up a session."""
    if session_id in _sessions:
        del _sessions[session_id]
    return {"message": "Session deleted."}


@app.get("/ai/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "quizzit-ai"}
