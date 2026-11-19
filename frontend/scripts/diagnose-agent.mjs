import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const diagnostic = { calls: [], results: [], responseCodes: [] };
let expectedId = "";

page.on("request", request => {
  if (!request.url().endsWith("/api/agent/turn")) return;
  const body = request.postDataJSON();
  if (body.continuation) diagnostic.results.push((body.results || []).map(result => ({
    name: result.name,
    success: result.success,
    errorCode: result.error === "Browser validation or execution failed" ? "BROWSER_FAILURE" : undefined,
  })));
});
page.on("response", async response => {
  if (!response.url().endsWith("/api/agent/turn")) return;
  diagnostic.responseCodes.push(response.status());
  for (const line of (await response.text()).split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === "tool_request") for (const call of event.calls || []) {
      const args = JSON.parse(call.function.arguments);
      diagnostic.calls.push({ name: call.function.name, keys: Object.keys(args).sort(), taskIdMatches: args.taskId === expectedId, status: args.status, priority: args.priority });
    }
  }
});

try {
  await page.goto("http://localhost:8080/");
  await page.getByRole("button", { name: "Create project", exact: true }).first().click();
  const project = page.getByRole("dialog", { name: "New project" });
  await project.getByLabel("Project name").fill("Agent move diagnostic");
  await project.getByRole("button", { name: /Create project/ }).click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  const task = page.getByRole("dialog", { name: "Create task" });
  await task.getByLabel("Task title").fill("Define project scope and requirements");
  await task.getByRole("button", { name: "Save task" }).click();
  expectedId = await page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")).state.tasks.find(item => item.title === "Define project scope and requirements").id);
  await page.getByRole("textbox", { name: "Ask AI Copilot" }).fill("انقل مهمة Define project scope and requirements إلى In Progress");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForFunction(() => !document.querySelector(".chat-compose input")?.disabled, null, { timeout: 105_000 });
  diagnostic.status = await page.locator(".column-progress").getByText("Define project scope and requirements").count() ? "progress" : "unchanged";
  diagnostic.failedTrace = await page.locator(".trace.failed").count();
  console.log(JSON.stringify(diagnostic));
} finally {
  await browser.close();
}
