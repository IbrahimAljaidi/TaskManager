import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 }, hasTouch: true });

test("touch drag moves a task into an empty column", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Touch project");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Touch task");
  await page.getByRole("button", { name: "Save task" }).click();
  const start = await page.getByRole("button", { name: "Drag Touch task" }).boundingBox();
  const end = await page.locator(".column-progress .column-head").boundingBox();
  if (!start || !end) throw new Error("Touch drag target missing");
  const source = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const destination = { x: end.x + end.width / 2, y: end.y + 20 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [source] });
  await page.waitForTimeout(180); // TouchSensor's real 150 ms activation threshold.
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: source.x + (destination.x - source.x) * step / 12, y: source.y + (destination.y - source.y) * step / 12 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".column-progress")).toContainText("Touch task");
});
