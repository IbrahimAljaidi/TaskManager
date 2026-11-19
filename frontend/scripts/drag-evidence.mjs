import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("../docs/verification", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(process.env.TASKFLOW_E2E_URL || "http://127.0.0.1:8080");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Drag verification");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  for (let index = 1; index <= 9; index++) {
    await page.getByRole("button", { name: "Add task" }).first().click();
    await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill(`Task ${index}`);
    await page.getByRole("button", { name: "Save task" }).click();
  }
  await page.screenshot({ path: "../docs/verification/taskflow-before-drag.png" });
  const from = await page.getByRole("button", { name: "Drag Task 1" }).boundingBox();
  const to = await page.locator(".column-progress .column-head").boundingBox();
  if (!from || !to) throw new Error("Drag coordinates missing");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 18, { steps: 24 });
  await page.locator(".column-progress.over").waitFor();
  await page.screenshot({ path: "../docs/verification/taskflow-drag-over.png" });
  await page.mouse.up();
  await page.locator(".column-progress .task-card").filter({ hasText: "Task 1" }).waitFor();
  await page.screenshot({ path: "../docs/verification/taskflow-after-drag.png" });
  await page.reload();
  const persisted = await page.locator(".column-progress .task-card").filter({ hasText: "Task 1" }).isVisible();
  console.log(`manual_drag_persisted=${persisted}`);
  if (!persisted) process.exitCode = 1;
} finally {
  await browser.close();
}
