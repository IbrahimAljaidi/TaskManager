"""Regression coverage for streamed OpenRouter responses."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main

BASE = {
    "message": "Move Build to Done",
    "scope": "p1",
    "projects": [{"id": "p1", "name": "One"}],
    "tasks": [{"id": "t1", "projectId": "p1", "title": "Build"}],
    "version": 1,
}


@pytest.fixture(autouse=True)
def supported_scope(monkeypatch):
    async def classify(_message, _history):
        return "supported"
    monkeypatch.setattr(main, "classify_scope", classify)


def mock_stream(monkeypatch, chunks, *, complete=True):
    monkeypatch.setenv("OPENROUTER_API_KEY", "x" * 32)
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            text="".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks)
            + ("data: [DONE]\n" if complete else ""),
        )
    )
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=transport, **kwargs),
    )
    return TestClient(main.app)


def test_truncated_tool_arguments_are_safe(monkeypatch):
    client = mock_stream(
        monkeypatch,
        [
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call-1",
                                    "function": {
                                        "name": "move_task",
                                        "arguments": '{"taskId":"t1","status":"do',
                                    },
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ]
            },
            {"choices": [{"delta": {}, "finish_reason": "length"}]},
        ],
    )
    events = [json.loads(line) for line in client.post("/api/agent/turn", json=BASE).text.splitlines()]
    error = next(event for event in events if event["type"] == "error")
    assert error["code"] == "OUTPUT_TRUNCATED"
    assert "Unterminated" not in json.dumps(error)


def test_fragmented_multiple_tool_calls_are_assembled(monkeypatch):
    client = mock_stream(monkeypatch, [
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "id": "call-a", "function": {"name": "move_task", "arguments": '{"taskId":"t1","sta'}},
            {"index": 1, "id": "call-b", "function": {"name": "create_task", "arguments": '{"title":"N'}},
        ]}}]},
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"arguments": 'tus":"done"}'}},
            {"index": 1, "function": {"arguments": 'ew task"}'}},
        ]}}]},
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ])
    response = [json.loads(line) for line in client.post("/api/agent/turn", json=BASE).text.splitlines()]
    request = next(event for event in response if event["type"] == "tool_request")
    assert [call["function"]["name"] for call in request["calls"]] == ["move_task", "create_task"]
    assert json.loads(request["calls"][0]["function"]["arguments"])["status"] == "done"


def test_malformed_complete_tool_call_is_sanitized(monkeypatch):
    client = mock_stream(monkeypatch, [
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call-a", "function": {"name": "move_task", "arguments": '{"taskId":"t1","status":"do'}}]}}]},
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ])
    response = [json.loads(line) for line in client.post("/api/agent/turn", json=BASE).text.splitlines()]
    error = next(event for event in response if event["type"] == "error")
    assert error["code"] == "INVALID_TOOL_CALL"
    assert "message" not in error
    assert "Unterminated" not in json.dumps(error)


def test_stream_disconnect_does_not_accept_partial_answer(monkeypatch):
    client = mock_stream(monkeypatch, [
        {"choices": [{"delta": {"content": "Partial"}, "finish_reason": "stop"}]}
    ], complete=False)
    response = [json.loads(line) for line in client.post("/api/agent/turn", json=BASE).text.splitlines()]
    assert response[-1]["type"] == "error"
    assert response[-1]["code"] == "STREAM_INCOMPLETE"


def test_provider_timeout_is_sanitized(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "x" * 32)
    transport = httpx.MockTransport(lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("secret raw timeout", request=request)))
    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    response = [json.loads(line) for line in TestClient(main.app).post("/api/agent/turn", json=BASE).text.splitlines()]
    assert response[-1]["code"] == "TIMEOUT"
    assert "secret raw timeout" not in json.dumps(response)
