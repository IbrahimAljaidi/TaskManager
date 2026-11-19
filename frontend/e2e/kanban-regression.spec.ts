import { expect, test, type Page } from "@playwright/test";
test.use({ viewport: { width: 1440, height: 900 } });

async function createProject(page: Page, name = "Drag project") {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: /Create project/ }).last().click();
}

async function addTask(page: Page, title: string, status = "To Do") {
  await page.getByRole("button", { name: "Add task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await dialog.getByLabel("Task title").fill(title);
  await dialog.getByLabel("Status").selectOption({ label: status });
  await dialog.getByRole("button", { name: "Save task" }).click();
}

async function dragTo(page: Page, title: string, target: string) {
  const from = await page.getByRole("button", { name: `Drag ${title}` }).boundingBox();
  const to = await page.locator(target).boundingBox();
  if (!from || !to) throw new Error("Drag target missing");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(24, to.height / 2), { steps: 22 });
  if (target.includes("task-card")) await expect(page.locator(target)).toHaveClass(/drop-target/);
  await page.mouse.up();
}

test("dragging to the top of a tall empty column changes status", async ({ page }) => {
  await createProject(page);
  for (let i = 1; i <= 9; i++) await addTask(page, `Task ${i}`);
  await dragTo(page, "Task 1", ".column-progress .column-head");
  await expect(page.locator(".column-progress")).toContainText("Task 1");
});

test("tasks move in both directions and every view reflects the same state", async ({ page }) => {
  await createProject(page);
  await addTask(page, "Move across board");
  await dragTo(page, "Move across board", ".column-progress .column-head");
  await expect(page.locator(".column-progress .task-card")).toContainText("Move across board");
  await expect(page.locator(".stat-icon.amber").locator("xpath=..")).toContainText("1");
  await dragTo(page, "Move across board", ".column-done .column-head");
  await expect(page.locator(".column-done .task-card")).toContainText("Move across board");
  await expect(page.locator(".progress-overview")).toContainText("100%");
  await dragTo(page, "Move across board", ".column-todo .column-head");
  await expect(page.locator(".column-todo .task-card")).toContainText("Move across board");
  await expect(page.locator(".progress-overview")).toContainText("0%");
  await page.getByRole("tab", { name: "List" }).click();
  await expect(page.locator(".list-row")).toContainText("To Do");
  await page.reload();
  await expect(page.locator(".column-todo .task-card")).toContainText("Move across board");
});

test("dragging within a column persists task order and stays within its project", async ({ page }) => {
  await createProject(page, "First project");
  await addTask(page, "First task");
  await addTask(page, "Second task");
  await addTask(page, "Third task");
  await dragTo(page, "Third task", ".column-todo .task-card:first-child");
  await expect(page.locator(".column-todo .task-card .task-content strong").first()).toHaveText("Third task");
  await page.reload();
  await expect(page.locator(".column-todo .task-card .task-content strong").first()).toHaveText("Third task");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Second project");
  await page.getByRole("button", { name: /Create project/ }).last().click();
  await expect(page.getByText("Third task")).toHaveCount(0);
  await page.getByRole("button", { name: "First project" }).click();
  await expect(page.locator(".column-todo .task-card .task-content strong").first()).toHaveText("Third task");
});

test("keyboard drag handle moves a task between columns", async ({ page }) => {
  await createProject(page);
  await addTask(page, "Keyboard task");
  const handle = page.getByRole("button", { name: "Drag Keyboard task" });
  await handle.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".column-progress")).toContainText("Keyboard task");
  await handle.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".column-done")).toContainText("Keyboard task");
  await handle.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".column-progress")).toContainText("Keyboard task");
});
