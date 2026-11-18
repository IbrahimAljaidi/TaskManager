import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

test.skip(!process.env.TASKFLOW_LIVE_AI, "requires the local OpenRouter configuration");

test("Smart Restaurant proposal waits for approval and creates browser-owned tasks", async ({ page }) => {
  test.setTimeout(420_000);
  const output = resolve("../docs/verification");
  await mkdir(output, { recursive: true });
  const events: Array<Record<string, string | number | boolean | string[]>> = [];
  let providerCalls = 0;
  const providerCap = Number(process.env.TASKFLOW_LIVE_CALL_CAP || 5);
  let result = "failed";
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    const cost = body.continuation ? 1 : 2; // Classification + generation, or continuation generation.
    if (providerCalls + cost > providerCap) {
      events.push({ event: "provider_cap_reached", estimatedCalls: providerCalls });
      await route.fulfill({ status: 429, contentType: "application/json", body: '{"code":"TEST_PROVIDER_CAP"}' });
      return;
    }
    providerCalls += cost;
    events.push({ event: "agent_request", continuation: !!body.continuation, estimatedCalls: providerCalls });
    await route.continue();
  });
  page.on("response", async response => {
    if (!response.url().endsWith("/api/agent/turn")) return;
    try {
      const lines = (await response.text()).split("\n").filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line);
        if (["tool_request", "error", "done"].includes(event.type)) events.push({ event: event.type, code: event.code || "", toolNames: (event.calls || []).map((call: { function: { name: string } }) => call.function.name) });
      }
    } catch { events.push({ event: "response_unreadable", status: response.status() }); }
  });
  try {
    await page.goto("http://localhost:8080/");
    await expect(page.getByRole("heading", { name: /FlowMate/i }).first()).toBeVisible();
    const initialProjects = await page.locator(".project-link:not(:has(.all))").count();
    expect(initialProjects).toBe(0);
    events.push({ event: "fresh_context", emptyProjects: initialProjects === 0 });
    await page.screenshot({ path: resolve(output, "smart-restaurant-initial.png"), fullPage: true });

    await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("I want to build a restaurant reservation product called Smart Restaurant E2E Test. Before planning it, ask me the key questions you need answered. Please do not create a proposal yet.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("textbox", { name: "Ask FlowMate" })).toBeEnabled({ timeout: 90_000 });
    await expect(page.locator(".bubble.assistant").last()).toBeVisible();
    const clarification = await page.locator(".bubble.assistant").last().innerText();
    events.push({ event: "clarification", askedQuestion: clarification.includes("?") });
    await page.screenshot({ path: resolve(output, "smart-restaurant-clarification.png"), fullPage: true });

    await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Here are the requirements for Smart Restaurant E2E Test: a responsive web application for restaurant reservations. Customers can book, modify, and cancel reservations. Restaurant owners manage tables and bookings. An AI assistant handles natural-language reservation requests. We have a three-month development timeline and three development roles: frontend engineer, backend engineer, and AI engineer. No payment or POS integration in the initial MVP. Propose a professional project description and a realistic, ordered task plan with priorities and useful checklists. Show the editable project preview for approval; do not create the project yet.");
    await page.getByRole("button", { name: "Send message" }).click();
    const proposal = page.getByRole("dialog", { name: "Project proposal" });
    await expect.poll(async () => await proposal.isVisible() ? "proposal" : await page.locator(".chat-error").isVisible() ? "error" : "pending", { timeout: 90_000 }).not.toBe("pending");
    await expect(proposal).toBeVisible({ timeout: 90_000 });
    await proposal.screenshot({ path: resolve(output, "smart-restaurant-preview.png") });
    await page.screenshot({ path: resolve(output, "smart-restaurant-before-approval.png"), fullPage: true });
    await expect(page.getByRole("button", { name: "Smart Restaurant E2E Test", exact: true })).toHaveCount(0);
    const name = await proposal.getByLabel("Name").inputValue();
    const goal = await proposal.getByLabel("Goal").inputValue();
    const description = await proposal.locator("label textarea").first().inputValue();
    const taskCount = await proposal.locator(".proposal-detail").count();
    const checklistCount = await proposal.locator(".proposal-check").count();
    const priorities = await proposal.locator(".proposal-task select").evaluateAll(nodes => nodes.map(node => (node as HTMLSelectElement).value));
    const titles = await proposal.locator('input[aria-label^="Suggested task "]').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value));
    expect(name).toContain("Smart Restaurant");
    expect(description.length).toBeGreaterThan(80);
    const planText = (goal + " " + description).toLowerCase();
    for (const required of ["reservation", "book", "cancel", "table", "ai", "payment", "pos"]) expect(planText).toContain(required);
    expect(planText).toMatch(/three.month|3.month|12.week|twelve.week/);
    expect(taskCount).toBeGreaterThanOrEqual(5);
    expect(checklistCount).toBeGreaterThan(0);
    expect(priorities.every(priority => ["low", "medium", "high", "urgent"].includes(priority))).toBe(true);
    events.push({ event: "proposal_visible", taskCount, checklistCount, priorities });

    // Exercise the editor, then explicitly approve. No project may exist before this click.
    await proposal.getByLabel("Name").fill("Smart Restaurant E2E Test");
    await proposal.getByRole("button", { name: "Approve & create project" }).click();
    await expect(page.getByRole("heading", { name: "Smart Restaurant E2E Test" })).toBeVisible();
    await expect(page.locator(".task-card")).toHaveCount(taskCount);
    events.push({ event: "approved_and_created", taskCount: await page.locator(".task-card").count() });
    await page.screenshot({ path: resolve(output, "smart-restaurant-created.png"), fullPage: true });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Smart Restaurant E2E Test" })).toBeVisible();
    await expect(page.locator(".task-card")).toHaveCount(taskCount);
    events.push({ event: "refresh_persisted", taskCount: await page.locator(".task-card").count() });
    if (process.env.TASKFLOW_TEST_TASK_OPERATIONS === "1") {
      const manualTitle = titles[0];
      const aiMoveTitle = titles[1];
      const priorityIndex = priorities.findIndex((priority, index) => index > 1 && priority !== "urgent");
      const priorityTitle = titles[priorityIndex >= 0 ? priorityIndex : 2];
      await page.getByRole("button", { name: "Drag " + manualTitle }).focus();
      await page.keyboard.press("Alt+ArrowRight");
      await expect(page.locator(".column-progress")).toContainText(manualTitle);
      events.push({ event: "manual_move", progressCount: await page.locator(".column-progress .task-card").count() });
      await page.screenshot({ path: resolve(output, "smart-restaurant-manual-move.png"), fullPage: true });

      async function ask(message: string) {
        await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(message);
        await page.getByRole("button", { name: "Send message" }).click();
        await expect(page.getByRole("textbox", { name: "Ask FlowMate" })).toBeEnabled({ timeout: 100_000 });
        await expect(page.locator(".chat-error")).toHaveCount(0);
        await expect(page.locator(".trace.done").last()).toBeVisible();
      }

      await ask(`انقل مهمة ${aiMoveTitle} إلى In Progress`);
      await expect(page.locator(".column-progress")).toContainText(aiMoveTitle);
      events.push({ event: "ai_move_arabic", progressCount: await page.locator(".column-progress .task-card").count() });
      await page.screenshot({ path: resolve(output, "smart-restaurant-ai-progress.png"), fullPage: true });

      await ask(`Set the priority of the task named "${priorityTitle}" to urgent`);
      await expect(page.locator(".task-card").filter({ hasText: priorityTitle })).toContainText("urgent");
      events.push({ event: "ai_priority_english", urgentVisible: true });
      await page.screenshot({ path: resolve(output, "smart-restaurant-priority.png"), fullPage: true });

      await ask(`Move the task named "${aiMoveTitle}" to Done`);
      await expect(page.locator(".column-done")).toContainText(aiMoveTitle);
      await expect(page.locator(".column-progress")).toContainText(manualTitle);
      events.push({ event: "ai_move_done", doneCount: await page.locator(".column-done .task-card").count() });
      await page.screenshot({ path: resolve(output, "smart-restaurant-done.png"), fullPage: true });

      await page.getByRole("tab", { name: "List" }).click();
      await expect(page.locator(".list-row").filter({ hasText: aiMoveTitle })).toContainText("Done");
      await expect(page.locator(".list-row").filter({ hasText: manualTitle })).toContainText("In Progress");
      await page.screenshot({ path: resolve(output, "smart-restaurant-list.png"), fullPage: true });
      await page.getByRole("tab", { name: "Analytics" }).click();
      await expect(page.locator(".breakdown")).toContainText("In Progress 1");
      await expect(page.locator(".breakdown")).toContainText("Done 1");
      events.push({ event: "analytics_verified", progressCount: 1, doneCount: 1, totalTasks: taskCount });
      await page.screenshot({ path: resolve(output, "smart-restaurant-analytics.png"), fullPage: true });

      await page.getByRole("button", { name: "New project", exact: true }).click();
      await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Isolation Control E2E");
      await page.getByRole("button", { name: /Create project/ }).last().click();
      await expect(page.locator(".stats .stat").first()).toContainText("0");
      await page.getByRole("button", { name: "Smart Restaurant E2E Test", exact: true }).click();
      await page.getByRole("tab", { name: "Board" }).click();
      await expect(page.locator(".task-card")).toHaveCount(taskCount);
      events.push({ event: "project_isolation", restoredTaskCount: await page.locator(".task-card").count() });
      await page.reload();
      await expect(page.locator(".column-progress")).toContainText(manualTitle);
      await expect(page.locator(".column-done")).toContainText(aiMoveTitle);
      await expect(page.locator(".task-card").filter({ hasText: priorityTitle })).toContainText("urgent");
      await expect(page.locator(".task-card")).toHaveCount(taskCount);
      events.push({ event: "operations_persisted", taskCount: await page.locator(".task-card").count() });
      await page.screenshot({ path: resolve(output, "smart-restaurant-persisted.png"), fullPage: true });
    }
    result = "passed";
  } finally {
    await page.screenshot({ path: resolve(output, "smart-restaurant-final.png"), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, "smart-restaurant-trace.json"), JSON.stringify({ result, estimatedProviderCalls: providerCalls, events }, null, 2));
  }
});
