import { describe, expect, it } from "vitest";
import { analytics, type Task } from "./domain";
const task = (status: Task["status"], dueDate = ""): Task => ({ id: crypto.randomUUID(), projectId: "one", title: "Task", description: "", notes: "", status, priority: "medium", dueDate, tags: [], checklist: [], order: 1, createdAt: "", updatedAt: "" });
describe("project analytics", () => {
  it("uses only supplied project tasks", () => {
    expect(analytics([task("todo"), task("done")])).toMatchObject({ total: 2, done: 1, progress: 50 });
    expect(analytics([])).toMatchObject({ total: 0, progress: 0 });
  });
  it("counts overdue unfinished tasks", () => {
    expect(analytics([task("todo", "2020-01-01"), task("done", "2020-01-01")]).overdue).toBe(1);
  });
});
