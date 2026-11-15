import { expect, test } from "@playwright/test";

test.skip(!process.env.TASKFLOW_LIVE_AI, "requires an authorized local provider key");
test("real provider proposes a project and creates it only after edited approval", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ask AI Copilot" }).fill("Create a project named Customer Support Bot. Goal: build a bilingual FAQ assistant for our website. Suggest a concise description and three implementation tasks with priorities. Show me the editable proposal for approval.");
  await page.getByRole("button", { name: "Send message" }).click();
  const proposal = page.getByRole("dialog", { name: "Project proposal" });
  await expect(proposal).toBeVisible({ timeout: 80_000 });
  await expect(page.getByRole("button", { name: "Customer Support Bot", exact: true })).toHaveCount(0);
  await proposal.screenshot({ path: "../docs/verification/taskflow-live-project-proposal.png" });
  await proposal.getByLabel("Name").fill("Customer Support Bot Approved");
  await proposal.getByRole("button", { name: "Approve & create project" }).click();
  await expect(page.getByRole("heading", { name: "Customer Support Bot Approved" })).toBeVisible();
  await expect(page.locator(".task-card")).toHaveCount(3);
  await page.screenshot({ path: "../docs/verification/taskflow-live-project-created.png" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Customer Support Bot Approved" })).toBeVisible();
  await expect(page.locator(".task-card")).toHaveCount(3);
});
