import { expect, test } from "@playwright/test";

test.skip(!process.env.TASKFLOW_LIVE_AI, "requires an authorized local provider key");
test("real provider tool call moves a browser-owned task", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Live verification");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Move this verification item");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByRole("textbox", { name: "Ask AI Copilot" }).fill("Move the task named 'Move this verification item' to Done. Use the move_task tool.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".column-done")).toContainText("Move this verification item", { timeout: 90_000 });
  await expect(page.locator(".trace.done")).toContainText(/Move task/i);
  await expect(page.locator(".chat-error")).toHaveCount(0);
});
