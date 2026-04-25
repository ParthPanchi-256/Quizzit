"""
LLM Provider Abstraction — Zero Vendor Lock-in

Uses Python Protocol (structural subtyping) so any LLM client that
implements `invoke(messages) -> AIMessage` works as a drop-in replacement.

Switch providers via LLM_PROVIDER env var:
  groq     → ChatGroq (default, free tier)
  openai   → ChatOpenAI
  anthropic → ChatAnthropic
  ollama   → ChatOllama (local)
"""

from __future__ import annotations
import os
from typing import Protocol, runtime_checkable, Any
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────
# Abstract interface — any LLM must satisfy this Protocol
# ──────────────────────────────────────────────────────────────

@runtime_checkable
class LLMProvider(Protocol):
    """Structural protocol for LLM providers. Any object with an
    `invoke` method accepting a list of messages works."""

    def invoke(self, messages: list, **kwargs: Any) -> Any: ...

    def with_structured_output(self, schema: Any, **kwargs: Any) -> Any: ...


# ──────────────────────────────────────────────────────────────
# Provider registry — maps string keys to factory functions
# ──────────────────────────────────────────────────────────────

_PROVIDER_REGISTRY: dict[str, Any] = {}


def register_provider(name: str):
    """Decorator to register a provider factory."""
    def decorator(fn):
        _PROVIDER_REGISTRY[name] = fn
        return fn
    return decorator


@register_provider("groq")
def _create_groq() -> LLMProvider:
    from langchain_groq import ChatGroq
    return ChatGroq(
        model=os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.7")),
        max_tokens=int(os.getenv("LLM_MAX_TOKENS", "4096")),
    )


@register_provider("openai")
def _create_openai() -> LLMProvider:
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=os.getenv("LLM_MODEL", "gpt-4o"),
        api_key=os.getenv("OPENAI_API_KEY"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.7")),
        max_tokens=int(os.getenv("LLM_MAX_TOKENS", "4096")),
    )


@register_provider("anthropic")
def _create_anthropic() -> LLMProvider:
    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(
        model=os.getenv("LLM_MODEL", "claude-sonnet-4-20250514"),
        api_key=os.getenv("ANTHROPIC_API_KEY"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.7")),
        max_tokens=int(os.getenv("LLM_MAX_TOKENS", "4096")),
    )


@register_provider("ollama")
def _create_ollama() -> LLMProvider:
    from langchain_ollama import ChatOllama
    return ChatOllama(
        model=os.getenv("LLM_MODEL", "llama3"),
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.7")),
    )


# ──────────────────────────────────────────────────────────────
# Factory — single entry point
# ──────────────────────────────────────────────────────────────

def create_llm(provider: str | None = None) -> LLMProvider:
    """Create an LLM instance based on the provider name.

    Args:
        provider: One of 'groq', 'openai', 'anthropic', 'ollama'.
                  Defaults to LLM_PROVIDER env var, then 'groq'.
    """
    name = (provider or os.getenv("LLM_PROVIDER", "groq")).lower().strip()
    factory = _PROVIDER_REGISTRY.get(name)
    if not factory:
        available = ", ".join(_PROVIDER_REGISTRY.keys())
        raise ValueError(f"Unknown LLM provider '{name}'. Available: {available}")
    return factory()


# ──────────────────────────────────────────────────────────────
# App-wide settings
# ──────────────────────────────────────────────────────────────

QUIZZIT_API_URL = os.getenv("QUIZZIT_API_URL", "http://localhost:5000/api")
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "30"))
