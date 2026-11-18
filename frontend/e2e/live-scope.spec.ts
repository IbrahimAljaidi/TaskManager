import { expect, test } from "@playwright/test";

test.skip(!process.env.TASKFLOW_LIVE_AI, "requires an authorized local provider key");
test("real Arabic weather request and city follow-up stay outside TaskFlow scope", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  for (const [index, question] of ["كم الطقس اليوم؟", "رياض"].entries()) {
    await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(question);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".bubble.assistant").nth(index)).toContainText("المشاريع", { timeout: 60_000 });
    await expect(page.locator(".trace")).toHaveCount(0);
  }
  const replies = await page.locator(".bubble.assistant").allTextContents();
  expect(replies).toHaveLength(2);
  expect(replies.every(reply => !/\d+\s*°/.test(reply))).toBe(true);
});
