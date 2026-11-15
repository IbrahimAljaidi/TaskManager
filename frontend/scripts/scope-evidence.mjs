import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("../docs/verification", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(process.env.TASKFLOW_E2E_URL || "http://127.0.0.1:8080");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("AI Chatbot");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  for (const [index, question] of ["كم الطقس اليوم؟", "رياض"].entries()) {
    await page.getByRole("textbox", { name: "Ask AI Copilot" }).fill(question);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.locator(".bubble.assistant").nth(index).waitFor();
    await page.waitForFunction(() => !document.querySelector(".chat-compose input")?.disabled);
  }
  const replies = await page.locator(".bubble.assistant").allTextContents();
  const safe = replies.length === 2 && replies.every(reply => reply.includes("المشاريع") && !/\d+\s*°/.test(reply));
  const tools = await page.locator(".trace").count();
  await page.screenshot({ path: "../docs/verification/taskflow-off-topic-ar.png" });
  console.log(`off_topic_safe=${safe} task_tools=${tools}`);
  if (!safe || tools !== 0) process.exitCode = 1;
} finally {
  await browser.close();
}
