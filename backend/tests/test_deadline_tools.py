"""Deadline fields are part of real browser tool calls, not description text."""

import json

import pytest

from app.tools import ToolValidationError, validate_calls


def call(name, arguments):
    return [{"id": "deadline", "function": {"name": name, "arguments": json.dumps(arguments)}}]


def test_create_update_and_proposal_deadline_fields():
    examples = [
        ("create_task", {"title": "Requirements Analysis", "dueDate": "2026-11-18", "dueTime": "17:00", "dueTimeZone": "Asia/Riyadh"}),
        ("update_task", {"taskId": "task-1", "dueDate": "", "dueTime": "", "dueTimeZone": ""}),
        ("propose_project", {"name": "Launch", "goal": "Ship", "description": "Plan", "tasks": [{"title": "Requirements Analysis", "dueDate": "2026-11-18", "dueTime": "17:00", "dueTimeZone": "Asia/Riyadh"}]}),
    ]
    for name, arguments in examples:
        result = validate_calls(call(name, arguments))
        assert json.loads(result[0]["function"]["arguments"]) == arguments


@pytest.mark.parametrize("deadline", [
    {"dueDate": "2026-02-30"},
    {"dueDate": "2026-11-18", "dueTime": "25:00"},
    {"dueDate": "2026-11-18", "dueTimeZone": "Mars/Nowhere"},
    {"dueTime": "17:00"},
])
def test_invalid_deadlines_are_rejected(deadline):
    with pytest.raises(ToolValidationError):
        validate_calls(call("create_task", {"title": "Invalid", **deadline}))
