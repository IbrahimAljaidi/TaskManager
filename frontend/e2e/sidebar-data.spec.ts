import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

async function createProject(page: Page, name: string) {
  const first = await page.getByRole("button", { name: "Create project", exact: true }).count();
  await (first ? page.getByRole("button", { name: "Create project", exact: true }).first() : page.getByRole("button", { name: "New project", exact: true })).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByRole("button", { name: /Create project/ }).click();
}

async function addTask(page: Page, title: string, status: string, priority: string) {
  await page.getByRole("button", { name: "Add task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await dialog.getByLabel("Task title").fill(title);
  await dialog.getByLabel("Status").selectOption({ label: status });
  await dialog.getByLabel("Priority").selectOption(priority.toLowerCase());
  await dialog.getByLabel("Due date").fill("2027-06-15");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByRole("textbox", { name: "Checklist item 1" }).fill("Verify reservation");
  await dialog.getByRole("button", { name: "Save task" }).click();
}

async function openData(page: Page, action: "Export" | "Import" | "Clear") {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await page.getByRole("menuitem", { name: action }).click();
}

async function exportBackup(page: Page, project?: string) {
  await openData(page, "Export");
  if (project) await page.getByRole("dialog", { name: "Export data" }).getByLabel("Export scope").selectOption({ label: project });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { json: JSON.parse(Buffer.concat(chunks).toString("utf8")), filename: file.suggestedFilename() };
}

async function importBackup(page: Page, json: unknown) {
  await openData(page, "Import");
  await page.getByRole("dialog", { name: "Import data" }).locator('input[type="file"]').setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
}

test("sidebar collapse, persistence, menu, and Arabic RTL", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.screenshot({ path: "../docs/verification/sidebar-expanded.png", fullPage: false });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".sidebar")).toHaveCSS("width", "68px");
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute("title", "Board");
  await page.locator(".sidebar").getByRole("button", { name: "Dashboard" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.locator(".sidebar").getByRole("button", { name: "Board", exact: true }).click();
  await page.screenshot({ path: "../docs/verification/sidebar-collapsed.png", fullPage: false });
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await openData(page, "Export");
  await page.getByRole("dialog", { name: "Export data" }).getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.screenshot({ path: "../docs/verification/sidebar-data-menu.png", fullPage: false });
  await expect(page.getByRole("menuitem", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Clear" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: "البيانات" })).toBeVisible();
  await page.getByRole("button", { name: "طي الشريط الجانبي" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await expect(page.getByRole("button", { name: "البيانات" })).toBeVisible();
});

test("export, validated import, replacement, and scoped clear preserve data", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("unrelated-test-key", "keep"));
  await createProject(page, "Alpha");
  await addTask(page, "Alpha task", "In Progress", "High");
  await createProject(page, "Beta");
  await addTask(page, "Beta task", "Done", "Urgent");
  const all = await exportBackup(page);
  expect(all.filename).toBe("taskflow-backup.json");
  expect(all.json.version).toBe(2);
  expect(all.json.projects.map((p: { name: string }) => p.name)).toEqual(["Alpha", "Beta"]);
  expect(all.json.tasks).toHaveLength(2);
  const alpha = await exportBackup(page, "Alpha");
  expect(alpha.filename).toBe("taskflow-alpha.json");
  expect(alpha.json.projects).toHaveLength(1);
  expect(alpha.json.tasks).toHaveLength(1);
  expect(alpha.json.tasks[0]).toMatchObject({ title: "Alpha task", status: "progress", priority: "high", dueDate: "2027-06-15", checklist: [{ text: "Verify reservation", done: false }] });
  const original = await page.evaluate(() => localStorage.getItem("taskflow-v1"));
  await importBackup(page, { ...all.json, version: 99 });
  await expect(page.getByRole("dialog", { name: "Import data" }).getByRole("alert")).toContainText("No data was changed");
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(original);
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Cancel" }).click();
  await importBackup(page, alpha.json);
  await expect(page.getByText("Alpha · 1 tasks")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Import as New" })).toBeChecked();
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  let state = await page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
  expect(state.projects).toHaveLength(3);
  expect(new Set(state.projects.map((p: { id: string }) => p.id)).size).toBe(3);
  expect(new Set(state.tasks.map((t: { id: string }) => t.id)).size).toBe(3);
  expect(state.tasks.filter((t: { title: string }) => t.title === "Alpha task")).toHaveLength(2);
  // A duplicate project name makes replacement ambiguous; a unique matching Beta remains replaceable.
  const beta = await exportBackup(page, "Beta");
  const modifiedBeta = structuredClone(beta.json);
  modifiedBeta.tasks[0].title = "Beta restored";
  await importBackup(page, modifiedBeta);
  await page.getByRole("radio", { name: "Replace Existing" }).check();
  await expect(page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Type REPLACE" }).fill("REPLACE");
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  state = await page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
  expect(state.projects).toHaveLength(3);
  expect(state.tasks.filter((t: { title: string }) => t.title === "Beta restored")).toHaveLength(1);
  expect(state.tasks.filter((t: { title: string }) => t.title === "Alpha task")).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".column-done")).toContainText("Beta restored");
  const beforeClear = await page.evaluate(() => localStorage.getItem("taskflow-v1"));
  await openData(page, "Clear");
  await expect(page.getByRole("button", { name: "Clear data" })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(beforeClear);
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Backup" }).click();
  expect((await backupDownload).suggestedFilename()).toBe("taskflow-backup.json");
  await page.getByRole("textbox", { name: "Type CLEAR" }).fill("CLEAR");
  await page.getByRole("button", { name: "Clear data" }).click();
  state = await page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
  expect(state.projects).toEqual([]); expect(state.tasks).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("unrelated-test-key"))).toBe("keep");
  await page.reload();
  await expect(page.getByText("Great work starts here.")).toBeVisible();
  await importBackup(page, all.json);
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  state = await page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
  expect(state.projects).toHaveLength(2); expect(state.tasks).toHaveLength(2);
  expect(state.tasks.find((t: { title: string }) => t.title === "Alpha task")).toMatchObject({ status: "progress", priority: "high", dueDate: "2027-06-15", checklist: [{ text: "Verify reservation", done: false }] });
});
