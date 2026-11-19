import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("../docs/verification", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(process.env.TASKFLOW_E2E_URL || "http://127.0.0.1:3000");
await page.waitForTimeout(350);
console.log("desktop", await page.evaluate(() => ({ width: window.innerWidth, copilot: !!document.querySelector(".copilot"), sidebar: document.querySelector(".sidebar")?.getBoundingClientRect().toJSON() })));
await page.getByRole("button", { name: "Create project" }).click();
await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("TaskFlow Platform");
await page.getByRole("dialog", { name: "New project" }).getByLabel("What is the goal?").fill("Build the next generation task management platform with AI.");
await page.getByRole("button", { name: /Create project/ }).last().click();
for (const [title, status, priority, tag] of [
  ["Research user needs", "To Do", "medium", "Research"],
  ["Design system (UI/UX)", "To Do", "high", "Design"],
  ["Implement Kanban board", "In Progress", "high", "Development"],
  ["Integrate AI agent", "In Progress", "urgent", "AI"],
  ["Project setup & structure", "Done", "low", "Setup"],
]) {
  await page.getByRole("button", { name: "Add task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await dialog.getByLabel("Task title").fill(title);
  await dialog.getByLabel("Status").selectOption({ label: status });
  await dialog.getByLabel("Priority").selectOption({ label: priority });
  await dialog.getByLabel("Tags").fill(tag);
  await dialog.getByRole("button", { name: "Save task" }).click();
}
console.log("after tasks", await page.evaluate(() => ({ width: window.innerWidth, copilot: document.querySelector(".copilot")?.getBoundingClientRect().toJSON(), shell: document.querySelector(".app-shell")?.className })));
await page.waitForTimeout(700);
console.log("screenshot layout", await page.evaluate(() => ({ chat: document.querySelector(".copilot")?.getBoundingClientRect().toJSON(), shell: document.querySelector(".app-shell")?.className })));
await page.screenshot({ path: "../docs/verification/taskflow-dark.png", fullPage: true });
await page.route("**/api/agent/turn", route => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"I can help prioritize the next step for your project."}\n{"type":"done"}\n' }));
await page.getByRole("textbox", { name: "Ask AI Copilot" }).fill("What should I do next?");
await page.getByRole("button", { name: "Send message" }).click();
await page.locator(".bubble.assistant").waitFor();
await page.screenshot({ path: "../docs/verification/taskflow-dark-chat.png", fullPage: true });
await page.getByRole("button", { name: "Toggle theme" }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: "../docs/verification/taskflow-light.png", fullPage: true });
await page.screenshot({ path: "../docs/verification/taskflow-light-chat.png", fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
console.log("mobile", await page.evaluate(() => ({ width: window.innerWidth, copilot: !!document.querySelector(".copilot"), sidebar: document.querySelector(".sidebar")?.getBoundingClientRect().toJSON() })));
await page.screenshot({ path: "../docs/verification/taskflow-mobile-light.png", fullPage: true });
await browser.close();
