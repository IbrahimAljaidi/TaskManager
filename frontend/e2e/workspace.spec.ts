import { test, expect } from "@playwright/test";
test("projects isolate tasks and persist after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Alpha");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Alpha task");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByText("Alpha task")).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Beta");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await expect(page.getByText("Alpha task")).toHaveCount(0);
  await page.getByRole("button", { name: "Alpha" }).click();
  await expect(page.getByText("Alpha task")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Alpha task")).toBeVisible();
});
test("theme and mobile menu work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
});
test("board drag and list share the same task", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Delivery");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Ship release");
  await page.getByRole("button", { name: "Save task" }).click();
  const from = await page.getByRole("button", { name: "Drag Ship release" }).boundingBox();
  const to = await page.locator(".column-progress .empty-column").boundingBox();
  if (!from || !to) throw new Error("Drag target missing");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 18 });
  await page.mouse.up();
  await expect(page.locator(".column-progress")).toContainText("Ship release");
  await expect(page.locator(".drag-preview")).toHaveCount(0);
  await page.getByRole("tab", { name: "List" }).click();
  await expect(page.locator(".list-row")).toContainText("In Progress");
});
test("copilot executes a mocked tool request in the browser", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Agent");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Review agent");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    const line = body.continuation
      ? { type: "delta", text: "Moved Review agent to Done." }
      : { type: "tool_request", continuation: "mock", calls: [{ id: "call-1", function: { name: "move_task", arguments: JSON.stringify({ taskId: body.tasks[0].id, status: "done" }) } }] };
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(line) + "\n" + (body.continuation ? '{"type":"done"}\n' : "") });
  });
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Move Review agent to Done");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".column-done")).toContainText("Review agent");
  await expect(page.locator(".bubble.assistant")).toContainText("Moved Review agent to Done.");
});
test("copilot project proposal waits for edited approval", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    const line = body.continuation
      ? { type: "delta", text: "The proposal is ready for your review." }
      : { type: "tool_request", continuation: "mock", calls: [{ id: "proposal-1", function: { name: "propose_project", arguments: JSON.stringify({ name: "Launch", goal: "Ship a website", description: "A practical launch plan", tasks: [{ title: "Draft pages", priority: "high" }] }) } }] };
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(line) + "\n" + (body.continuation ? '{"type":"done"}\n' : "") });
  });
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Plan a website launch");
  await page.getByRole("button", { name: "Send message" }).click();
  const dialog = page.getByRole("dialog", { name: "Project proposal" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch", exact: true })).toHaveCount(0);
  await dialog.getByLabel("Name").fill("Launch 2027");
  await dialog.getByRole("textbox", { name: "Suggested task 1" }).fill("Draft landing page");
  await dialog.getByRole("textbox", { name: "Description for task 1" }).fill("Write the first version");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByRole("textbox", { name: "Checklist item 1 for task 1" }).fill("Write headline");
  await dialog.getByRole("button", { name: "Approve & create project" }).click();
  await expect(page.getByRole("button", { name: "Launch 2027" })).toBeVisible();
  await expect(page.locator(".column-todo")).toContainText("Draft landing page");
  await page.locator(".task-content").filter({ hasText: "Draft landing page" }).click();
  await expect(page.getByRole("dialog", { name: "Edit task" }).getByRole("textbox", { name: "Checklist item 1" })).toHaveValue("Write headline");
});
test("project settings rename and delete local project", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Old name");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.getByRole("button", { name: "Edit project" }).click();
  await page.getByRole("dialog", { name: "Project settings" }).getByLabel("Name").fill("New name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "New name" })).toBeVisible();
  await page.getByRole("button", { name: "Edit project" }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByRole("button", { name: "New name" })).toHaveCount(0);
});
