import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

test("pointer drag on a long board succeeds with reliable activation", async ({ page }) => {
  const output = resolve("../docs/verification");
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Pointer Drag Verification");
  await page.getByRole("dialog", { name: "New project" }).getByLabel("What is the goal?").fill("Build a responsive restaurant reservation application for customers and owners. Customers can create, modify, and cancel bookings. Owners manage tables and bookings. An AI assistant handles natural-language reservation requests. The MVP takes three months and three development roles, without payment or POS integration.");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  for (let index = 1; index <= 10; index++) {
    await page.getByRole("button", { name: "Add task" }).first().click();
    await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill(`Pointer item ${index}`);
    await page.getByRole("button", { name: "Save task" }).click();
  }
  await page.reload();
  await expect(page.locator(".column-todo .task-card")).toHaveCount(10);
  const handle = page.getByRole("button", { name: "Drag Pointer item 1", exact: true });
  const target = page.locator(".column-progress .empty-column");
  const initialHandle = await handle.boundingBox();
  const initialTarget = await target.boundingBox();
  if (!initialHandle || !initialTarget) throw new Error("Drag geometry unavailable");
  const initialHandleCenterY = initialHandle.y + initialHandle.height / 2;
  const initialTargetCenterY = initialTarget.y + initialTarget.height / 2;
  await page.screenshot({ path: resolve(output, "pointer-drag-before.png"), fullPage: true });

  // Replay the original failing mouse sequence before applying any scrolling or activation step.
  await page.mouse.move(initialHandle.x + initialHandle.width / 2, initialHandleCenterY);
  await page.mouse.down();
  await page.mouse.move(initialTarget.x + initialTarget.width / 2, initialTargetCenterY, { steps: 18 });
  await page.mouse.up();
  const naiveMoved = (await page.locator(".column-progress .task-card").allTextContents()).some(text => text.includes("Pointer item 1"));
  await page.screenshot({ path: resolve(output, "pointer-drag-naive-result.png"), fullPage: true });

  let startY = initialHandleCenterY;
  let endY = initialTargetCenterY;
  if (!naiveMoved) {
    await handle.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox();
    const end = await target.boundingBox();
    if (!start || !end) throw new Error("Visible drag geometry unavailable");
    const startX = start.x + start.width / 2;
    startY = start.y + start.height / 2;
    const endX = end.x + end.width / 2;
    endY = end.y + end.height / 2;
    expect(startY).toBeGreaterThanOrEqual(0);
    expect(startY).toBeLessThan(720);
    expect(endY).toBeGreaterThanOrEqual(0);
    expect(endY).toBeLessThan(720);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 25 });
    await page.screenshot({ path: resolve(output, "pointer-drag-over.png") });
    await page.mouse.up();
  }
  await expect(page.locator(".column-progress")).toContainText("Pointer item 1");
  await page.screenshot({ path: resolve(output, "pointer-drag-after.png"), fullPage: true });
  await page.reload();
  await expect(page.locator(".column-progress")).toContainText("Pointer item 1");
  await writeFile(resolve(output, "pointer-drag-trace.json"), JSON.stringify({ result: "passed", viewportHeight: 720, initialHandleCenterY, initialTargetCenterY, naiveMoved, enhancedUsed: !naiveMoved, visibleHandleCenterY: startY, visibleTargetCenterY: endY, persistedAfterRefresh: true }, null, 2));
});
