import asyncio
import json
import time

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main
from app.tools import ToolValidationError, validate_calls

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

def test_continuation_rejects_tampering_expiration_and_wrong_scope():
    state = {"scope": "p1", "version": 1, "expires": time.time() + 60, "calls": [], "messages": [], "answer": {}, "step": 1}
    signed = main.token(state)
    assert main.untoken(signed, "p1", 1) == state
    with pytest.raises(HTTPException):
        main.untoken(signed, "p2", 1)
    with pytest.raises(HTTPException):
        main.untoken(signed, "p1", 0)
    tampered = json.loads(signed)
    tampered["p"] = tampered["p"].replace('"p1"', '"p2"')
    with pytest.raises(HTTPException):
        main.untoken(json.dumps(tampered), "p1", 1)
    state["expires"] = time.time() - 1
    with pytest.raises(HTTPException):
        main.untoken(main.token(state), "p1", 1)

def test_failed_browser_result_reaches_model_as_failure(monkeypatch):
    turns = []
    async def fake(messages, _on_delta):
        turns.append(messages)
        if len(turns) == 1:
            return {"role": "assistant", "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "move_task", "arguments": '{"taskId":"Build","status":"progress"}'}}]}
        assert json.loads(messages[-1]["content"])["error"] == "TASK_NOT_FOUND"
        assert json.loads(messages[-1]["content"])["success"] is False
        return {"role": "assistant", "content": "I could not move that task."}
    monkeypatch.setattr(main, "provider", fake)
    first = events(client.post("/api/agent/turn", json=BASE))
    request = next(event for event in first if event["type"] == "tool_request")
    assert json.loads(request["calls"][0]["function"]["arguments"])["taskId"] == "Build"
    second = events(client.post("/api/agent/turn", json={**BASE, "continuation": request["continuation"], "results": [{"id": "call-1", "name": "move_task", "success": False, "error": "TASK_NOT_FOUND"}]}))
    assert second[-1]["type"] == "done"

def test_malformed_project_tool_call_retries_once_then_waits_for_browser_approval(monkeypatch):
    turns = []
    proposal = {"name": "Smart Restaurant E2E Test", "goal": "Build restaurant reservations", "description": "A responsive reservation application", "tasks": [{"title": "Build booking flow", "priority": "high", "checklist": [{"text": "Create reservation form"}]}]}

    async def fake(messages, _on_delta):
        turns.append(messages)
        if len(turns) == 1:
            return {"role": "assistant", "tool_calls": [{"id": "bad", "type": "function", "function": {"name": "propose_project", "arguments": '{"name":"Smart Restaurant E2E Test","tasks":['}}]}
        if len(turns) == 2:
            assert "Reissue one complete tool call" in messages[1]["content"]
            return {"role": "assistant", "tool_calls": [{"id": "good", "type": "function", "function": {"name": "propose_project", "arguments": json.dumps(proposal)}}]}
        assert json.loads(messages[-1]["content"])["success"] is True
        return {"role": "assistant", "content": "The proposal is ready for your approval."}

    monkeypatch.setattr(main, "provider", fake)
    first = events(client.post("/api/agent/turn", json={**BASE, "message": "Plan Smart Restaurant E2E Test"}))
    request = next(event for event in first if event["type"] == "tool_request")
    assert request["calls"][0]["function"]["name"] == "propose_project"
    assert len(turns) == 2
    second = events(client.post("/api/agent/turn", json={**BASE, "message": "Plan Smart Restaurant E2E Test", "continuation": request["continuation"], "results": [{"id": "good", "name": "propose_project", "success": True, "value": {"status": "proposed"}}]}))
    assert second[-1]["type"] == "done"

def test_bounded_large_project_proposal_is_accepted():
    proposal = {"name": "Smart Restaurant E2E Test", "goal": "Restaurant reservations", "description": "A responsive reservation application", "tasks": [{"title": f"Milestone {index}", "description": "Detailed acceptance criteria. " * 30, "priority": "high", "checklist": [{"text": "Verify customer flow"}, {"text": "Verify owner flow"}]} for index in range(10)]}
    raw = json.dumps(proposal)
    assert 8_000 < len(raw) < 20_000
    calls = [{"id": "proposal", "function": {"name": "propose_project", "arguments": raw}}]
    assert validate_calls(calls)[0]["function"]["name"] == "propose_project"
    with pytest.raises(ToolValidationError) as invalid:
        validate_calls([{"id": "proposal", "function": {"name": "propose_project", "arguments": raw[:-1]}}])
    assert invalid.value.reason == "arguments_json"

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
