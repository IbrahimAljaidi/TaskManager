import { describe, expect, it } from "vitest";
import { makeBackup, parseBackup } from "./data-transfer";
import type { Message, Project, Task } from "./domain";

const project: Project = { id: "project-1", name: "Restaurant", goal: "Reservations", description: "Table booking MVP", createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-02T00:00:00.000Z" };
const task: Task = { id: "task-1", projectId: project.id, title: "Reserve a table", description: "Customer flow", notes: "Owner approval", status: "progress", priority: "high", dueDate: "2027-06-15", tags: ["MVP"], checklist: [{ id: "check-1", text: "Confirm booking", done: true }], order: 4, createdAt: project.createdAt, updatedAt: project.updatedAt };
const message = (id: string, role: Message["role"], content: string): Message => ({ id, role, content, at: project.createdAt });

describe("TaskFlow backup format", () => {
  it("exports only the selected project and fully restores task metadata", () => {
    const other = { ...project, id: "project-2", name: "Other" };
    const messages = { [project.id]: [message("m1", "user", "Build reservations"), message("m2", "assistant", "Plan ready")], [other.id]: [message("m3", "user", "Unrelated")], all: [message("m4", "user", "Global question")] };
    const backup = makeBackup([project, other], [task, { ...task, id: "task-2", projectId: other.id }], project.id, messages);
    expect(backup.version).toBe(2);
    expect(backup.projects).toEqual([project]);
    expect(backup.tasks).toEqual([task]);
    expect(parseBackup(JSON.stringify(backup)).tasks[0]).toEqual(task);
    expect(backup.conversations).toEqual({ [project.id]: messages[project.id] });
  });

  it("exports each project conversation and global chat without internal fields or credentials", () => {
    const other = { ...project, id: "project-2", name: "Other" };
    const withInternalField = { ...message("m1", "user", "OPENROUTER_API_KEY=sk-or-v1-1234567890abcdef"), continuation: "signed-private-continuation" };
    const backup = makeBackup([project, other], [task], undefined, { [project.id]: [withInternalField], [other.id]: [message("m2", "assistant", "Other project reply")], all: [message("m3", "user", "Global question")] });
    expect(Object.keys(backup.conversations)).toEqual([project.id, other.id, "all"]);
    expect(backup.conversations[other.id][0].content).toBe("Other project reply");
    expect(backup.conversations.all[0].content).toBe("Global question");
    expect(JSON.stringify(backup)).not.toContain("signed-private-continuation");
    expect(JSON.stringify(backup)).not.toContain("sk-or-v1-1234567890abcdef");
  });

  it("accepts a version 1 backup and supplies empty conversations", () => {
    const current = makeBackup([project], [task]);
    const { conversations: _ignored, ...old } = current;
    void _ignored;
    const restored = parseBackup(JSON.stringify({ ...old, version: 1 }));
    expect(restored.version).toBe(2);
    expect(restored.conversations).toEqual({});
    expect(restored.tasks).toEqual([task]);
  });

  it("preserves optional deadline time and timezone while accepting old date-only tasks", () => {
    const timed = { ...task, dueTime: "17:00", dueTimeZone: "Asia/Riyadh" };
    expect(parseBackup(JSON.stringify(makeBackup([project], [timed]))).tasks[0]).toEqual(timed);
    expect(parseBackup(JSON.stringify(makeBackup([project], [task]))).tasks[0]).toEqual(task);
    expect(() => parseBackup(JSON.stringify({ ...makeBackup([project], [task]), tasks: [{ ...task, dueDate: "", dueTime: "17:00" }] }))).toThrow();
  });

  it("rejects invalid versions, duplicate IDs, orphan tasks, and malformed JSON", () => {
    const backup = makeBackup([project], [task]);
    expect(() => parseBackup("{" )).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 3 }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, projects: [project, project] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, tasks: [{ ...task, projectId: "missing" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, tasks: [{ ...task, status: "blocked" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, conversations: { missing: [message("m1", "user", "Orphan")] } }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, conversations: { [project.id]: [message("m1", "user", "One"), message("m1", "assistant", "Two")] } }))).toThrow();
  });
});
