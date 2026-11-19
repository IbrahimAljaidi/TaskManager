import { expect, test, type Page } from "@playwright/test";

async function addTask(page: Page, title: string) {
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill(title);
  await page.getByRole("button", { name: "Save task" }).click();
}

test("FlowMate resolves browser tasks, updates the shared store, and reports lookup failures", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("FlowMate verification");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await addTask(page, "Define project scope and requirements");
  await addTask(page, "Unchanged item");
  const move = async (taskId: string, status: string, success = true) => {
    let results: Array<{ success: boolean; value?: { id: string }; error?: string }> = [];
    let expectedId = "";
    await page.route("**/api/agent/turn", async route => {
      const body = route.request().postDataJSON();
      if (body.continuation) {
        results = body.results;
        expect(body.version).toBeGreaterThanOrEqual(1);
        return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Action processed."}\n{"type":"done"}\n' });
      }
      expectedId = body.tasks.find((task: { title: string }) => task.title === "Define project scope and requirements")?.id;
      const id = taskId === "REAL_ID" ? expectedId : taskId;
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "tool_request", continuation: "mock-signed-token", calls: [{ id: "call-1", function: { name: "move_task", arguments: JSON.stringify({ taskId: id, status }) } }] }) + "\n" });
    });
    await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(`Move task to ${status}`);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(success ? ".trace.done" : ".trace.failed").last()).toBeVisible();
    expect(results[0].success).toBe(success);
    if (success) expect(results[0].value?.id).toBe(expectedId);
    await page.unrouteAll();
    return results[0];
  };
  // Manual keyboard drag and AI use the same Zustand reorder action.
  await page.getByRole("button", { name: "Drag Unchanged item" }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".column-progress")).toContainText("Unchanged item");
  await move("Define project scope and requirements", "progress");
  await expect(page.locator(".column-progress")).toContainText("Define project scope and requirements");
  await move("REAL_ID", "done");
  await expect(page.locator(".column-done")).toContainText("Define project scope and requirements");
  await move("REAL_ID", "todo");
  await expect(page.locator(".column-todo")).toContainText("Define project scope and requirements");
  let priorityResult: { success: boolean; value?: { id: string } } | undefined;
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    if (body.continuation) {
      priorityResult = body.results[0];
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Priority updated."}\n{"type":"done"}\n' });
    }
    const taskId = body.tasks.find((task: { title: string }) => task.title === "Define project scope and requirements").id;
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "tool_request", continuation: "mock-signed-token", calls: [{ id: "priority", function: { name: "update_task", arguments: JSON.stringify({ taskId, priority: "urgent" }) } }] }) + "\n" });
  });
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Set the project scope task priority to urgent");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".column-todo .task-card").filter({ hasText: "Define project scope and requirements" })).toContainText("urgent");
  expect(priorityResult?.success).toBe(true);
  await page.unrouteAll();
  await page.getByRole("tab", { name: "List" }).click();
  await expect(page.locator(".list-row").filter({ hasText: "Define project scope and requirements" })).toContainText("To Do");
  await page.getByRole("tab", { name: "Analytics" }).click();
  await expect(page.locator(".breakdown")).toContainText("In Progress 1");
  await page.reload();
  await expect(page.locator(".column-todo")).toContainText("Define project scope and requirements");
  await expect(page.locator(".column-todo .task-card").filter({ hasText: "Define project scope and requirements" })).toContainText("urgent");
  await expect(page.locator(".column-progress")).toContainText("Unchanged item");
  const missing = await move("Unknown task", "done", false);
  expect(missing.error).toBe("TASK_NOT_FOUND");
  await expect(page.locator(".bubble.assistant").last()).toContainText("couldn't find that task");
  await addTask(page, "Duplicate task");
  await addTask(page, "Duplicate task");
  const ambiguous = await move("Duplicate task", "done", false);
  expect(ambiguous.error).toBe("TASK_AMBIGUOUS");
  await expect(page.locator(".bubble.assistant").last()).toContainText("More than one task");
  await expect(page.locator(".column-done")).not.toContainText("Duplicate task");
});
