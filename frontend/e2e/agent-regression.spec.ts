import { expect, test, type Page } from "@playwright/test";

async function send(page: Page, message: string) {
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function project(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Contrast project");
  await page.getByRole("button", { name: /Create project/ }).last().click();
}

async function contrast(page: Page, selector: string) {
  const ratio = await page.locator(selector).first().evaluate(element => {
    const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => rgb.map(value => { const x = value / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const style = getComputedStyle(element);
    const front = luminance(parse(style.color));
    const back = luminance(parse(style.backgroundColor));
    return (Math.max(front, back) + .05) / (Math.min(front, back) + .05);
  });
  expect(ratio, `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ["dark", "light"]) {
  test(`${theme} theme keeps chat and navigation readable`, async ({ page }) => {
    await project(page);
    if (theme === "light") await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.route("**/api/agent/turn", route => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Ready to help."}\n{"type":"done"}\n' }));
    await send(page, "Hello");
    await expect(page.locator(".bubble.assistant")).toContainText("Ready to help.");
    await contrast(page, ".bubble.user");
    await contrast(page, ".bubble.assistant");
    await contrast(page, ".sidebar-tip");
    await contrast(page, ".nav-item.active");
  });
}

test("truncated agent error is localized and chat recovers", async ({ page }) => {
  await page.goto("/");
  let calls = 0;
  await page.route("**/api/agent/turn", route => {
    calls++;
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: calls === 1
      ? '{"type":"error","code":"OUTPUT_TRUNCATED","correlationId":"test123"}\n'
      : '{"type":"delta","text":"I can help."}\n{"type":"done"}\n' });
  });
  await send(page, "مرحبا");
  await expect(page.locator(".chat-error")).toContainText("لم أتمكن من إكمال العملية");
  await expect(page.locator(".chat-error")).not.toContainText("OUTPUT_TRUNCATED");
  await expect(page.getByText("Copilot is thinking")).toHaveCount(0);
  await send(page, "Hello again");
  await expect(page.locator(".bubble.assistant")).toContainText("I can help.");
});

test("network failure shows a safe message and recovers", async ({ page }) => {
  await page.goto("/");
  let calls = 0;
  await page.route("**/api/agent/turn", route => {
    calls++;
    return calls === 1
      ? route.abort("timedout")
      : route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Available again."}\n{"type":"done"}\n' });
  });
  await send(page, "Hello");
  await expect(page.locator(".chat-error")).toContainText("temporarily unavailable");
  await expect(page.locator(".chat-error")).not.toContainText("timedout");
  await send(page, "Try again");
  await expect(page.locator(".bubble.assistant")).toContainText("Available again.");
});

test("multiple tool calls return separate results", async ({ page }) => {
  await project(page);
  let observedResults: unknown[] = [];
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    if (body.continuation) {
      observedResults = body.results;
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"The actions were processed."}\n{"type":"done"}\n' });
    }
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "tool_request", continuation: "mock", calls: [
      { id: "a", function: { name: "create_task", arguments: JSON.stringify({ title: "First item" }) } },
      { id: "b", function: { name: "create_task", arguments: JSON.stringify({ title: "Second item" }) } },
    ] }) + "\n" });
  });
  await send(page, "Create two tasks");
  await expect(page.locator(".column-todo")).toContainText("First item");
  await expect(page.locator(".column-todo")).toContainText("Second item");
  expect(observedResults).toMatchObject([{ id: "a", success: true }, { id: "b", success: true }]);
});

test("destructive agent action requires approval", async ({ page }) => {
  await project(page);
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Keep this task");
  await page.getByRole("button", { name: "Save task" }).click();
  let approved: unknown;
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    if (body.continuation) {
      approved = body.results[0].success;
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Deletion was declined."}\n{"type":"done"}\n' });
    }
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "tool_request", continuation: "mock", calls: [{ id: "delete", function: { name: "delete_task", arguments: JSON.stringify({ taskId: body.tasks[0].id }) } }] }) + "\n" });
  });
  page.once("dialog", dialog => dialog.dismiss());
  await send(page, "Delete this task");
  await expect(page.locator(".column-todo")).toContainText("Keep this task");
  await expect(page.locator(".bubble.assistant")).toContainText("Deletion was declined.");
  expect(approved).toBe(false);
});
