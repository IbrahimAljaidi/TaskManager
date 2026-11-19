import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

async function project(page: Page, name: string) {
  const button = page.getByRole("button", { name: "Create project", exact: true });
  await (await button.count() ? button.first() : page.getByRole("button", { name: "New project", exact: true })).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByRole("button", { name: /Create project/ }).click();
}

async function dataAction(page: Page, action: "Export" | "Import" | "Clear") {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await page.getByRole("menuitem", { name: action }).click();
}

async function downloadedJson(page: Page, selected?: string) {
  await dataAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export data" });
  if (selected) await dialog.getByLabel("Export scope").selectOption({ label: selected });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download backup" }).click();
  const stream = await (await download).createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

test("Docker serves updated Editorial sidebar and safe data flows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TaskFlow." })).toBeVisible();
  await expect(page.getByText("FlowMate", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".editorial-hero")).toBeVisible();
  await page.screenshot({ path: "../docs/verification/docker-sidebar-expanded.png" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "68px");
  await page.screenshot({ path: "../docs/verification/docker-sidebar-collapsed.png" });
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "176px");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Clear" })).toBeVisible();
  await page.screenshot({ path: "../docs/verification/docker-data-menu.png" });
  await page.keyboard.press("Escape");

  await project(page, "Docker Alpha");
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Reservation flow");
  await page.getByRole("dialog", { name: "Create task" }).getByRole("button", { name: "Save task" }).click();
  await project(page, "Docker Beta");
  const selected = await downloadedJson(page, "Docker Alpha");
  expect(selected.projects.map((p: { name: string }) => p.name)).toEqual(["Docker Alpha"]);
  expect(selected.tasks.map((t: { title: string }) => t.title)).toEqual(["Reservation flow"]);
  const all = await downloadedJson(page);
  expect(all.projects.map((p: { name: string }) => p.name)).toEqual(["Docker Alpha", "Docker Beta"]);
  expect(all.tasks).toHaveLength(1);

  const before = await page.evaluate(() => localStorage.getItem("taskflow-v1"));
  await dataAction(page, "Import");
  const importDialog = page.getByRole("dialog", { name: "Import data" });
  const file = importDialog.locator('input[type="file"]');
  await file.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...selected, version: 42 })) });
  await expect(importDialog.getByRole("alert")).toContainText("No data was changed");
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(before);
  await file.setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(selected)) });
  await expect(importDialog.getByText("Docker Alpha · 1 tasks")).toBeVisible();
  await expect(importDialog.getByRole("radio", { name: "Import as New" })).toBeChecked();
  await page.screenshot({ path: "../docs/verification/docker-import-preview.png" });
  await importDialog.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(before);

  await dataAction(page, "Clear");
  const clearDialog = page.getByRole("dialog", { name: "Clear data" });
  await expect(clearDialog.getByText(/permanently deletes/)).toBeVisible();
  await expect(clearDialog.getByRole("button", { name: "Clear data" })).toBeDisabled();
  await clearDialog.getByRole("textbox", { name: "Type CLEAR" }).fill("CLEAR");
  await expect(clearDialog.getByRole("button", { name: "Clear data" })).toBeEnabled();
  await page.screenshot({ path: "../docs/verification/docker-clear-confirmation.png" });
  await clearDialog.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(before);
});
