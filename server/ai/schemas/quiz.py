"""Pydantic schemas for request/response models."""

from __future__ import annotations
from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional


# ── Enums ──────────────────────────────────────────────────────

class QuestionType(str, Enum):
    SINGLE = "single"
    MULTIPLE = "multiple"
    FILL_BLANK = "fill_blank"


class SessionPhase(str, Enum):
    UPLOADING = "uploading"
    ANALYZING = "analyzing"
    CLARIFYING = "clarifying"
    SEARCHING = "searching"
    GENERATING = "generating"
    VERIFYING = "verifying"
    DONE = "done"
    ERROR = "error"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


# ── Quiz Output Schemas ───────────────────────────────────────

class OptionOut(BaseModel):
    optionText: str
    isCorrect: bool


class QuestionOut(BaseModel):
    questionText: str
    questionType: QuestionType = QuestionType.SINGLE
    points: int = Field(default=10, ge=1, le=100)
    timeLimit: Optional[int] = Field(default=None, ge=5, le=300)
    options: list[OptionOut]


class GeneratedQuiz(BaseModel):
    title: str
    description: str = ""
    timePerQuestion: int = Field(default=30, ge=5, le=300)
    questions: list[QuestionOut]


# ── Chat Message ──────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: MessageRole
    content: str
    phase: Optional[SessionPhase] = None
    metadata: Optional[dict] = None  # e.g. {"topics": [...], "questionCount": 10}


# ── API Request/Response ──────────────────────────────────────

class CreateSessionRequest(BaseModel):
    prompt: Optional[str] = None


class UserMessageRequest(BaseModel):
    message: str


class SessionResponse(BaseModel):
    sessionId: str
    phase: SessionPhase
    messages: list[ChatMessage]
    quiz: Optional[GeneratedQuiz] = None
    waitingForInput: bool = False


class FinalizeRequest(BaseModel):
    quizzitToken: str  # Educator's JWT to push quiz via Node API


class FinalizeResponse(BaseModel):
    success: bool
    quizId: Optional[str] = None
    message: str
