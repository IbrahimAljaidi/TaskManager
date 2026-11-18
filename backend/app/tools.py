"""Shared JSON schemas and strict validation for requested browser tools."""

import json
from datetime import date
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeadlineModel(StrictModel):
    dueDate: str | None = Field(default=None, pattern=r"^$|^\d{4}-\d{2}-\d{2}$", description="ISO calendar date YYYY-MM-DD; use an empty string to remove a deadline on update.")
    dueTime: str | None = Field(default=None, pattern=r"^$|^([01]\d|2[0-3]):[0-5]\d$", description="Optional local 24-hour time HH:mm; empty string removes it.")
    dueTimeZone: str | None = Field(default=None, max_length=80, description="Optional IANA timezone, such as Asia/Riyadh; empty string removes it.")

    @model_validator(mode="after")
    def valid_deadline(self):
        if self.dueDate:
            date.fromisoformat(self.dueDate)
        if (self.dueTime or self.dueTimeZone) and self.dueDate == "":
            raise ValueError("A deadline time or timezone requires a date")
        if self.dueTimeZone:
            try:
                ZoneInfo(self.dueTimeZone)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("Invalid IANA timezone") from exc
        return self


class ListTasks(StrictModel):
    query: str | None = Field(default=None, max_length=100)


class CreateTask(DeadlineModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    tags: list[str] | None = Field(default=None, max_length=12)

    @model_validator(mode="after")
    def date_for_time(self):
        if (self.dueTime or self.dueTimeZone) and not self.dueDate:
            raise ValueError("A deadline time or timezone requires a date")
        return self


class ChecklistItem(StrictModel):
    text: str = Field(min_length=1, max_length=200)
    done: bool = False


class UpdateTask(DeadlineModel):
    taskId: str = Field(min_length=1, max_length=80, description="Use the exact task ID from the browser snapshot. A unique exact title can be resolved by the browser; ask for clarification if names repeat.")
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    tags: list[str] | None = Field(default=None, max_length=12)
    checklist: list[ChecklistItem] | None = Field(default=None, max_length=30)


class MoveTask(StrictModel):
    taskId: str = Field(min_length=1, max_length=80, description="Exact task ID from the selected project's browser snapshot; a unique exact title also works. Never guess among duplicate titles.")
    status: Literal["todo", "progress", "done"]


class DeleteTask(StrictModel):
    taskId: str = Field(min_length=1, max_length=80)


class BatchUpdate(StrictModel):
    taskIds: list[str] = Field(min_length=1, max_length=30)
    status: Literal["todo", "progress", "done"] | None = None
    addTag: str | None = Field(default=None, min_length=1, max_length=30)


class ProposedTask(DeadlineModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    checklist: list[ChecklistItem] | None = Field(default=None, max_length=30)

    @model_validator(mode="after")
    def date_for_time(self):
        if (self.dueTime or self.dueTimeZone) and not self.dueDate:
            raise ValueError("A deadline time or timezone requires a date")
        return self


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
    "create_task": "Create a task in the selected project. If the user gives a deadline, set dueDate and optional dueTime/dueTimeZone fields, never description only.",
    "update_task": "Edit a selected project's task and its details. Set structured dueDate and optional dueTime/dueTimeZone for deadlines; use empty dueDate to remove a deadline.",
    "move_task": "Move a task to To Do, In Progress, or Done.",
    "delete_task": "Request deletion of one task; browser confirmation is required.",
    "batch_update": "Request several task changes; browser confirmation is required.",
    "propose_project": "Show an editable project and task proposal for human approval. Set structured dueDate and optional dueTime/dueTimeZone for task deadlines. Order tasks by prerequisites and mention useful dependencies in task descriptions.",
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

    def __init__(self, reason: str = "invalid", tool: str = "unknown", field: str = "unknown"):
        self.reason = reason
        self.tool = tool if tool in TOOL_MODELS else "unknown"
        self.field = field
        super().__init__(reason)


def validate_calls(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not 1 <= len(calls) <= 5:
        raise ToolValidationError("call_count")
    ids: set[str] = set()
    validated = []
    for call in calls:
        name = "unknown"
        try:
            name = call["function"]["name"]
            call_id = call["id"]
            raw = call["function"]["arguments"]
            if not isinstance(call_id, str) or not 1 <= len(call_id) <= 128:
                raise ToolValidationError("call_id", name)
            if call_id in ids or name not in TOOL_MODELS or not isinstance(raw, str):
                raise ToolValidationError("call_identity", name)
            if len(raw) > 20_000:
                raise ToolValidationError("arguments_length", name)
            try:
                args = json.loads(raw)
            except (TypeError, ValueError) as exc:
                raise ToolValidationError("arguments_json", name) from exc
            if not isinstance(args, dict):
                raise ToolValidationError("arguments_object", name)
            try:
                parsed = TOOL_MODELS[name].model_validate(args)
            except ValidationError as exc:
                first = exc.errors()[0]
                top_field = str(first["loc"][0]) if first["loc"] else "unknown"
                field = top_field if top_field in TOOL_MODELS[name].model_fields else "extra"
                raise ToolValidationError(first["type"], name, field) from exc
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
        except (KeyError, TypeError, ValueError) as exc:
            raise ToolValidationError("call_shape", name) from exc
    return validated
