"""The off-topic gate runs before any project or task tools."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import agent, main
from app.prompt import OFF_TOPIC_AR

BASE = {"scope": "all", "projects": [], "tasks": [], "history": [], "version": 0}


@pytest.mark.parametrize("message", [
    "كم الطقس اليوم؟",
    "هل أحتاج مظلة الآن في الرياض؟",
    "What's the forecast for tomorrow?",
    "How much is the stock trading for right now?",
])
def test_off_topic_redirect_does_not_call_task_model(monkeypatch, message):
    async def classify(_message, _history):
        return "off_topic"

    async def forbidden_provider(_messages, _on_delta):
        raise AssertionError("task agent must not run for an off-topic request")

    monkeypatch.setattr(main, "classify_scope", classify)
    monkeypatch.setattr(main, "provider", forbidden_provider)
    events = [json.loads(line) for line in TestClient(main.app).post(
        "/api/agent/turn", json={**BASE, "message": message}
    ).text.splitlines()]
    assert [event["type"] for event in events] == ["status", "delta", "done"]
    reply = events[1]["text"]
    assert "FlowMate" in reply
    assert not any(word in reply for word in ("°C", "forecast", "temperature", "درجة"))
    if any("\u0600" <= char <= "\u06ff" for char in message):
        assert "المشاريع" in reply
    else:
        assert "projects" in reply


@pytest.mark.parametrize("message", [
    "Hello!",
    "مرحبا، أحتاج خطة لمشروعي",
    "How should I prioritize a Kanban backlog?",
    "ساعدني في تقسيم مشروع تطبيق الطقس إلى مهام",
])
def test_supported_requests_continue_to_agent(monkeypatch, message):
    async def classify(_message, _history):
        return "supported"

    async def provider(_messages, on_delta):
        await on_delta("Ready to help with your project.")
        return {"role": "assistant", "content": "Ready to help with your project."}

    monkeypatch.setattr(main, "classify_scope", classify)
    monkeypatch.setattr(main, "provider", provider)
    events = [json.loads(line) for line in TestClient(main.app).post(
        "/api/agent/turn", json={**BASE, "message": message}
    ).text.splitlines()]
    assert events[-1]["type"] == "done"
    assert any(event["type"] == "delta" for event in events)


def test_classifier_uses_forced_schema_tool(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "x" * 32)

    def handler(request):
        body = json.loads(request.content)
        assert body["tool_choice"]["function"]["name"] == "classify_scope"
        assert body["reasoning_effort"] == "minimal"
        assert body["messages"][-1]["content"] == "Plan a weather app"
        assert body["messages"][-2]["content"] == "We are planning an app"
        return httpx.Response(200, json={"choices": [{"message": {"tool_calls": [
            {"function": {"name": "classify_scope", "arguments": '{"scope":"supported"}'}}
        ]}}]})

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    assert asyncio.run(agent.classify_scope("Plan a weather app", [{"role": "user", "content": "We are planning an app"}])) == "supported"


def test_classifier_rejects_malformed_provider_decision(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "x" * 32)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"choices": [{"message": {"content": "maybe"}}]}))
    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    with pytest.raises(agent.AgentError) as error:
        asyncio.run(agent.classify_scope("What is the news?", []))
    assert error.value.code == "CLASSIFICATION_FAILED"


def test_one_word_followup_to_redirect_never_reaches_task_model(monkeypatch):
    async def forbidden_classifier(_message, _history):
        raise AssertionError("known ambiguous follow-up should use conversation-state guard")

    async def forbidden_provider(_messages, _on_delta):
        raise AssertionError("task tools must not be offered")

    monkeypatch.setattr(main, "classify_scope", forbidden_classifier)
    monkeypatch.setattr(main, "provider", forbidden_provider)
    response = TestClient(main.app).post("/api/agent/turn", json={
        **BASE,
        "message": "رياض",
        "history": [
            {"role": "user", "content": "كم الطقس اليوم؟"},
            {"role": "assistant", "content": OFF_TOPIC_AR},
        ],
    })
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "done"
    assert events[1]["text"] == OFF_TOPIC_AR
    assert not main.follows_off_topic_redirect(
        "Create a project", [{"role": "assistant", "content": OFF_TOPIC_AR}]
    )
