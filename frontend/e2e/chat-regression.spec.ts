import { expect, test } from "@playwright/test";

test("user message appears immediately, thinking reflects the pending request, and duplicate send is blocked", async ({ page }) => {
  await page.goto("/");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/agent/turn", async route => {
    await pending;
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"status","code":"THINKING"}\n{"type":"delta","text":"Here is a plan."}\n{"type":"done"}\n' });
  });
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Help me plan a project");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".bubble.user")).toHaveText("Help me plan a project");
  await expect(page.locator(".thinking")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  release();
  await expect(page.locator(".bubble.assistant")).toHaveText("Here is a plan.");
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(page.locator(".executing")).toHaveCount(0);
  await expect(page.locator(".bubble.user")).toHaveCount(1);
});

test("Arabic chat bubbles use RTL and keep the newest response in view", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/agent/turn", route => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"أستطيع مساعدتك في تخطيط مشروعك."}\n{"type":"done"}\n' }));
  for (let index = 0; index < 14; index++) {
    await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(`نظم مهامي ${index}`);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".bubble.assistant")).toHaveCount(index + 1);
  }
  await expect(page.locator(".bubble.user").last()).toHaveAttribute("dir", "auto");
  await expect(page.locator(".bubble.assistant").last()).toHaveAttribute("dir", "auto");
  const scrolled = await page.locator(".chat-scroll").evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 3);
  expect(scrolled).toBe(true);
});

test("a project switch cancels pending chat without crossing conversation history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Alpha");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/agent/turn", async route => {
    await pending;
    try { await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Project reply"}\n{"type":"done"}\n' }); }
    catch { /* The original project's request was aborted on navigation. */ }
  });
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Alpha question");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".thinking")).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Beta");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  release();
  await expect(page.getByText("Alpha question")).toHaveCount(0);
  await expect(page.locator(".bubble.assistant")).toHaveCount(0);
  await page.getByRole("button", { name: "Alpha" }).click();
  await expect(page.locator(".bubble.user")).toContainText("Alpha question");
  await expect(page.locator(".thinking")).toHaveCount(0);
});

test("tool execution announces its real action and records success", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Actions");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.evaluate(() => {
    const state = window as unknown as { observedPhases: string[] };
    state.observedPhases = [];
    new MutationObserver(() => {
      if (document.querySelector(".executing")) state.observedPhases.push("executing");
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.route("**/api/agent/turn", route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: body.continuation
      ? '{"type":"delta","text":"Created the task."}\n{"type":"done"}\n'
      : JSON.stringify({ type: "tool_request", continuation: "mock", calls: [{ id: "create-1", function: { name: "create_task", arguments: '{"title":"Observed task"}' } }] }) + "\n" });
  });
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Create Observed task");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".column-todo")).toContainText("Observed task");
  await expect(page.locator(".trace.done")).toContainText("Create task");
  await expect(page.locator(".trace.done")).toContainText("Observed task");
  expect(await page.evaluate(() => (window as unknown as { observedPhases: string[] }).observedPhases)).toContain("executing");
});
