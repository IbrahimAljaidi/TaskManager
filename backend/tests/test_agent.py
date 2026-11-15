import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)
BASE = {"message": "Move a task", "scope": "p1", "projects": [{"id": "p1", "name": "One"}], "tasks": [{"id": "t1", "projectId": "p1", "title": "Build"}], "version": 1}

@pytest.fixture(autouse=True)
def supported_scope(monkeypatch):
    async def classify(_message, _history):
        return "supported"
    monkeypatch.setattr(main, "classify_scope", classify)

def events(response):
    return [json.loads(line) for line in response.text.splitlines()]

def test_scope_rejects_other_project():
    response = client.post("/api/agent/turn", json={**BASE, "tasks": [{"id": "t1", "projectId": "p2"}]})
    assert response.status_code == 422

def test_missing_key_is_transparent(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    response = client.post("/api/agent/turn", json=BASE)
    assert any(e["type"] == "error" and e["code"] == "AGENT_UNAVAILABLE" for e in events(response))

def test_tool_handshake_and_verified_result(monkeypatch):
    calls = []
    async def fake(messages, on_delta):
        calls.append(messages)
        if len(calls) == 1:
            return {"role": "assistant", "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "move_task", "arguments": '{"taskId":"t1","status":"done"}'}}]}
        assert messages[-1]["role"] == "tool"
        assert json.loads(messages[-1]["content"])["success"] is True
        await on_delta("Moved Build to Done.")
        return {"role": "assistant", "content": "Moved Build to Done."}
    monkeypatch.setattr(main, "provider", fake)
    first = events(client.post("/api/agent/turn", json=BASE))
    request = next(e for e in first if e["type"] == "tool_request")
    second = events(client.post("/api/agent/turn", json={**BASE, "continuation": request["continuation"], "results": [{"id": "call-1", "name": "move_task", "success": True, "value": {"id": "t1", "status": "done"}}], "version": 2}))
    assert "".join(e.get("text", "") for e in second) == "Moved Build to Done."

def test_malformed_tool_arguments(monkeypatch):
    async def fake(_, on_delta):
        return {"role": "assistant", "tool_calls": [{"id": "bad", "function": {"name": "move_task", "arguments": "{"}}]}
    monkeypatch.setattr(main, "provider", fake)
    response = events(client.post("/api/agent/turn", json=BASE))
    assert any(e["type"] == "error" for e in response)

def test_openrouter_reads_runtime_environment_and_streams(monkeypatch):
    fake_key = "x" * 32
    monkeypatch.setenv("OPENROUTER_API_KEY", fake_key)
    monkeypatch.setenv("OPENROUTER_MODEL", "test/model")

    def handler(request):
        assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer " + fake_key
        body = json.loads(request.content)
        assert body["model"] == "test/model"
        assert body["stream"] is True
        assert body["tools"]
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n',
        )

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    deltas = []

    async def on_delta(chunk):
        deltas.append(chunk)

    answer = asyncio.run(main.provider([{"role": "user", "content": "Hi"}], on_delta))
    assert answer["content"] == "Hello"
    assert deltas == ["Hello"]
