"""Shared JSON schemas and strict validation for requested browser tools."""

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListTasks(StrictModel):
    query: str | None = Field(default=None, max_length=100)


class CreateTask(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    dueDate: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    tags: list[str] | None = Field(default=None, max_length=12)


class ChecklistItem(StrictModel):
    text: str = Field(min_length=1, max_length=200)
    done: bool = False


class UpdateTask(StrictModel):
    taskId: str = Field(min_length=1, max_length=80)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    dueDate: str | None = Field(default=None, pattern=r"^$|^\d{4}-\d{2}-\d{2}$")
    tags: list[str] | None = Field(default=None, max_length=12)
    checklist: list[ChecklistItem] | None = Field(default=None, max_length=30)


class MoveTask(StrictModel):
    taskId: str = Field(min_length=1, max_length=80)
    status: Literal["todo", "progress", "done"]


class DeleteTask(StrictModel):
    taskId: str = Field(min_length=1, max_length=80)


class BatchUpdate(StrictModel):
    taskIds: list[str] = Field(min_length=1, max_length=30)
    status: Literal["todo", "progress", "done"] | None = None
    addTag: str | None = Field(default=None, min_length=1, max_length=30)


class ProposedTask(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    checklist: list[ChecklistItem] | None = Field(default=None, max_length=30)


class ProposeProject(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    goal: str = Field(max_length=1000)
    description: str = Field(max_length=2000)
    tasks: list[ProposedTask] = Field(max_length=30)


TOOL_MODELS: dict[str, type[StrictModel]] = {
    "list_tasks": ListTasks,
    "create_task": CreateTask,
    "update_task": UpdateTask,
    "move_task": MoveTask,
    "delete_task": DeleteTask,
    "batch_update": BatchUpdate,
    "propose_project": ProposeProject,
}

TOOL_DESCRIPTIONS = {
    "list_tasks": "Read or search tasks in the selected scope.",
    "create_task": "Create a task in the selected project.",
    "update_task": "Edit a selected project's task and its details.",
    "move_task": "Move a task to To Do, In Progress, or Done.",
    "delete_task": "Request deletion of one task; browser confirmation is required.",
    "batch_update": "Request several task changes; browser confirmation is required.",
    "propose_project": "Show an editable project and task proposal for human approval. Order tasks by prerequisites and mention useful dependencies in task descriptions.",
}

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": name,
            "description": TOOL_DESCRIPTIONS[name],
            "parameters": model.model_json_schema(),
        },
    }
    for name, model in TOOL_MODELS.items()
]


class ToolValidationError(Exception):
    """A completed model tool request did not match the declared schema."""


def validate_calls(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not 1 <= len(calls) <= 5:
        raise ToolValidationError
    ids: set[str] = set()
    validated = []
    for call in calls:
        try:
            name = call["function"]["name"]
            call_id = call["id"]
            raw = call["function"]["arguments"]
            if not isinstance(call_id, str) or not 1 <= len(call_id) <= 128:
                raise ToolValidationError
            if call_id in ids or name not in TOOL_MODELS or not isinstance(raw, str):
                raise ToolValidationError
            if len(raw) > 8000:
                raise ToolValidationError
            args = json.loads(raw)
            if not isinstance(args, dict):
                raise ToolValidationError
            parsed = TOOL_MODELS[name].model_validate(args)
            normalized = parsed.model_dump(exclude_none=True)
            ids.add(call_id)
            validated.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(normalized, ensure_ascii=False),
                    },
                }
            )
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            raise ToolValidationError from exc
    return validated
