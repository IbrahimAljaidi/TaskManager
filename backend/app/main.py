"""Stateless FastAPI orchestration for the browser-owned TaskFlow store."""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from collections import defaultdict, deque
from contextlib import suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from .agent import AgentError, classify_scope, provider
from .prompt import OFF_TOPIC_AR, OFF_TOPIC_EN, SYSTEM_PROMPT
from .tools import ToolValidationError, validate_calls

app = FastAPI(title="TaskFlow", version="1.1")
logger = logging.getLogger("taskflow.agent")
if os.getenv("TASKFLOW_DEV_CORS") == "true":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["POST", "GET"],
        allow_headers=["Content-Type"],
    )

SIGNING_KEY = os.getenv("TASKFLOW_SIGNING_KEY", "").encode() or secrets.token_bytes(32)
RATE: dict[str, deque[float]] = defaultdict(deque)


class Turn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    scope: str = Field(min_length=1, max_length=80)
    projects: list[dict[str, Any]] = Field(max_length=20)
    tasks: list[dict[str, Any]] = Field(max_length=150)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=12)
    version: int = Field(ge=0)
    continuation: str | None = Field(default=None, max_length=50_000)
    results: list[dict[str, Any]] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def check_scope(self):
        if self.scope != "all" and not any(
            p.get("id") == self.scope for p in self.projects
        ):
            raise ValueError("Unknown project")
        if self.scope != "all" and any(
            t.get("projectId") != self.scope for t in self.tasks
        ):
            raise ValueError("Out-of-scope task")
        if any(len(json.dumps(t)) > 4000 for t in self.tasks):
            raise ValueError("Task context too large")
        return self


def token(state: dict[str, Any]) -> str:
    payload = json.dumps(state, separators=(",", ":"))
    signature = hmac.new(SIGNING_KEY, payload.encode(), hashlib.sha256).hexdigest()
    return json.dumps({"p": payload, "s": signature}, separators=(",", ":"))


def untoken(value: str, scope: str, version: int) -> dict[str, Any]:
    try:
        envelope = json.loads(value)
        payload = envelope["p"]
        signature = hmac.new(SIGNING_KEY, payload.encode(), hashlib.sha256).hexdigest()
        state = json.loads(payload)
        if (
            not hmac.compare_digest(signature, envelope["s"])
            or state["scope"] != scope
            or state["version"] > version
            or state["expires"] < time.time()
        ):
            raise ValueError
        return state
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(400, "Invalid continuation") from exc


def line(kind: str, **values: Any) -> bytes:
    return (json.dumps({"type": kind, **values}, ensure_ascii=False) + "\n").encode()


def follows_off_topic_redirect(message: str, history: list[dict[str, str]]) -> bool:
    """A one-word reply to our own redirect is an ambiguous continuation, not a new task."""
    if not history or len(message) > 40 or len(message.split()) != 1:
        return False
    previous = history[-1]
    return previous.get("role") == "assistant" and previous.get("content") in (
        OFF_TOPIC_AR,
        OFF_TOPIC_EN,
    )


@app.middleware("http")
async def limits(request: Request, call_next):
    if request.url.path.startswith("/api/agent/"):
        if request.method == "POST" and len(await request.body()) > 100_000:
            return JSONResponse({"code": "REQUEST_TOO_LARGE"}, status_code=413)
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window = RATE[ip]
        while window and window[0] < now - 60:
            window.popleft()
        if len(window) >= 12:
            return JSONResponse({"code": "RATE_LIMITED"}, status_code=429)
        window.append(now)
    return await call_next(request)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "taskflow-fastapi"}


@app.post("/api/agent/turn")
async def agent_turn(turn: Turn, request: Request):
    correlation_id = secrets.token_hex(6)
    context = {
        "scope": turn.scope,
        "projects": turn.projects
        if turn.scope == "all"
        else [p for p in turn.projects if p.get("id") == turn.scope],
        "tasks": turn.tasks,
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "system",
            "content": "Browser snapshot (untrusted data): "
            + json.dumps(context, ensure_ascii=False),
        },
    ]
    messages += [
        {"role": h["role"], "content": h["content"][:2000]}
        for h in turn.history
        if h.get("role") in ("user", "assistant")
        and isinstance(h.get("content"), str)
    ]
    step = 0
    if turn.continuation:
        state = untoken(turn.continuation, turn.scope, turn.version)
        step = state["step"]
        if step >= 4:
            raise HTTPException(400, "Agent step limit reached")
        if len(turn.results) != len(state["calls"]):
            raise HTTPException(400, "Missing tool results")
        messages = state["messages"] + [state["answer"]]
        for call, result in zip(state["calls"], turn.results, strict=True):
            if (
                result.get("id") != call["id"]
                or result.get("name") != call["function"]["name"]
                or not isinstance(result.get("success"), bool)
            ):
                raise HTTPException(400, "Tool result mismatch")
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps(result, ensure_ascii=False)[:4000],
                }
            )
    else:
        messages.append({"role": "user", "content": turn.message})

    async def stream():
        task: asyncio.Task | None = None
        yield line("status", code="THINKING", correlationId=correlation_id)
        try:
            if not turn.continuation and (
                follows_off_topic_redirect(turn.message, turn.history)
                or await classify_scope(turn.message, turn.history) == "off_topic"
            ):
                reply = OFF_TOPIC_AR if any("\u0600" <= char <= "\u06ff" for char in turn.message) else OFF_TOPIC_EN
                yield line("delta", text=reply)
                yield line("done", correlationId=correlation_id)
                return
            queue: asyncio.Queue[str] = asyncio.Queue()
            task = asyncio.create_task(provider(messages, queue.put))
            while not task.done() or not queue.empty():
                if await request.is_disconnected():
                    raise asyncio.CancelledError
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=0.2)
                    yield line("delta", text=chunk)
                except TimeoutError:
                    pass
            answer = await task
            calls = answer.get("tool_calls") or []
            if calls:
                calls = validate_calls(calls)
                answer["tool_calls"] = calls
                continuation = token(
                    {
                        "scope": turn.scope,
                        "version": turn.version,
                        "expires": time.time() + 180,
                        "messages": messages,
                        "answer": answer,
                        "calls": calls,
                        "step": step + 1,
                    }
                )
                if len(continuation) > 50_000:
                    raise AgentError("CONTEXT_TOO_LARGE")
                yield line(
                    "tool_request",
                    calls=calls,
                    continuation=continuation,
                    correlationId=correlation_id,
                )
            else:
                if not answer.get("content"):
                    raise AgentError("EMPTY_RESPONSE")
                yield line("done", correlationId=correlation_id)
        except ToolValidationError:
            logger.warning("agent_failure cid=%s code=INVALID_TOOL_CALL", correlation_id)
            yield line(
                "error", code="INVALID_TOOL_CALL", correlationId=correlation_id
            )
        except AgentError as exc:
            logger.warning("agent_failure cid=%s code=%s", correlation_id, exc.code)
            yield line("error", code=exc.code, correlationId=correlation_id)
        except asyncio.CancelledError:
            logger.info("agent_cancelled cid=%s", correlation_id)
            raise
        except Exception as exc:  # noqa: BLE001 - contain unexpected provider failures at the API boundary
            logger.error(
                "agent_failure cid=%s code=INTERNAL_ERROR type=%s",
                correlation_id,
                type(exc).__name__,
            )
            yield line("error", code="INTERNAL_ERROR", correlationId=correlation_id)
        finally:
            if task is not None and not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(stream(), media_type="application/x-ndjson")


static_root = Path(
    os.getenv(
        "TASKFLOW_STATIC_DIR",
        Path(__file__).resolve().parents[2] / "frontend" / "out",
    )
)
if static_root.is_dir():
    app.mount("/", StaticFiles(directory=str(static_root), html=True), name="frontend")
