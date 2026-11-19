import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function state(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
}

async function send(page: Page, message: string) {
  const replies = await page.locator(".bubble.assistant").count();
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".bubble.assistant")).toHaveCount(replies + 1);
  await expect(page.locator(".bubble.assistant").last()).toContainText("Done.");
}

test("FlowMate deadlines reach task fields and survive editing, approval, refresh, and backup", async ({ page }) => {
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    if (body.continuation) return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: '{"type":"delta","text":"Done."}\n{"type":"done"}\n' });
    const message = body.message as string;
    const timedId = body.tasks.find((task: { title: string }) => task.title === "Timed")?.id;
    const [name, args] = message.startsWith("Create date only") ? ["create_task", { title: "Date only", description: "Due 18 November 2026", dueDate: "" }]
      : message.startsWith("Create ambiguous") ? ["create_task", { title: "Ambiguous", description: "Due 11/12/2026" }]
      : message.startsWith("Create timed") ? ["create_task", { title: "Timed", description: "Requirements Analysis — due 18 November 2026 at 5:00 PM, Asia/Riyadh." }]
      : message.startsWith("أنشئ") ? ["create_task", { title: "Arabic task", description: "موعد ١٨ نوفمبر ٢٠٢٦ الساعة ٥ مساءً Asia/Riyadh" }]
      : message.startsWith("Create without") ? ["create_task", { title: "No deadline" }]
      : message.startsWith("Update deadline") ? ["update_task", { taskId: timedId, dueDate: "2026-11-20", dueTime: "09:30", dueTimeZone: "Asia/Riyadh" }]
      : message.startsWith("Remove deadline") ? ["update_task", { taskId: timedId, dueDate: "", dueTime: "", dueTimeZone: "" }]
      : ["propose_project", { name: "Deadline proposal", goal: "Ship", description: "Schedule", tasks: [{ title: "Milestone", dueDate: "2026-11-21", dueTime: "15:00", dueTimeZone: "Asia/Riyadh", priority: "high" }, { title: "Fallback milestone", description: "Due 22 November 2026 at 4:00 PM Asia/Riyadh" }] }];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "tool_request", continuation: "mock", calls: [{ id: "deadline", function: { name, arguments: JSON.stringify(args) } }] }) + "\n" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Deadline QA");
  await page.getByRole("dialog", { name: "New project" }).getByRole("button", { name: "Create project" }).click();
  await send(page, "Create date only: due 18 November 2026");
  await send(page, "Create timed: Requirements Analysis — due 18 November 2026 at 5:00 PM, Asia/Riyadh.");
  await send(page, "أنشئ مهمة موعدها ١٨ نوفمبر ٢٠٢٦ الساعة ٥ مساءً Asia/Riyadh");
  await send(page, "Create without a deadline");
  let data = await state(page);
  const byTitle = (title: string) => data.tasks.find((task: { title: string }) => task.title === title);
  expect(byTitle("Date only")).toMatchObject({ dueDate: "2026-11-18", dueTime: "", dueTimeZone: "" });
  expect(byTitle("Timed")).toMatchObject({ dueDate: "2026-11-18", dueTime: "17:00", dueTimeZone: "Asia/Riyadh" });
  expect(byTitle("Arabic task")).toMatchObject({ dueDate: "2026-11-18", dueTime: "17:00", dueTimeZone: "Asia/Riyadh" });
  expect(byTitle("No deadline")).toMatchObject({ dueDate: "", dueTime: "", dueTimeZone: "" });
  const replies = await page.locator(".bubble.assistant").count();
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill("Create ambiguous: due 11/12/2026");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".bubble.assistant")).toHaveCount(replies + 1);
  await expect(page.locator(".bubble.assistant").last()).toContainText("Please clarify the deadline");
  data = await state(page);
  expect(byTitle("Ambiguous")).toBeUndefined();
  await send(page, "Update deadline for Timed to 20 November 2026 at 9:30 AM Asia/Riyadh");
  data = await state(page);
  expect(byTitle("Timed")).toMatchObject({ dueDate: "2026-11-20", dueTime: "09:30", dueTimeZone: "Asia/Riyadh" });
  await send(page, "Remove deadline from Timed");
  data = await state(page);
  expect(byTitle("Timed")).toMatchObject({ dueDate: "", dueTime: "", dueTimeZone: "" });

  await page.locator(".column-todo .task-card").filter({ hasText: "Date only" }).locator(".task-content").click();
  const editor = page.getByRole("dialog", { name: "Edit task" });
  await expect(editor.getByLabel("Due date")).toHaveValue("2026-11-18");
  await editor.getByLabel("Due time (optional)").fill("11:45");
  await editor.getByLabel("Time zone (optional)").fill("Asia/Riyadh");
  await page.screenshot({ path: "../docs/verification/deadline-editor-docker.png" });
  await editor.getByRole("button", { name: "Save task" }).click();
  data = await state(page);
  expect(byTitle("Date only")).toMatchObject({ dueDate: "2026-11-18", dueTime: "11:45", dueTimeZone: "Asia/Riyadh" });
  await page.getByRole("tab", { name: "List" }).click();
  await expect(page.locator(".list-row").filter({ hasText: "Date only" })).toContainText("2026-11-18 11:45 Asia/Riyadh");
  await page.reload();
  data = await state(page);
  expect(byTitle("Date only").dueTime).toBe("11:45");

  await page.getByRole("button", { name: "All Projects", exact: true }).click();
  await send(page, "Plan a Deadline proposal project");
  const preview = page.getByRole("dialog", { name: "Project proposal" });
  await expect(preview.getByRole("textbox", { name: "Due date for task 1" })).toHaveValue("2026-11-21");
  await expect(preview.getByRole("textbox", { name: "Due time for task 1" })).toHaveValue("15:00");
  await expect(preview.getByRole("textbox", { name: "Due date for task 2" })).toHaveValue("2026-11-22");
  await expect(preview.getByRole("textbox", { name: "Due time for task 2" })).toHaveValue("16:00");
  await preview.getByRole("button", { name: "Approve & create project" }).click();
  data = await state(page);
  expect(byTitle("Milestone")).toMatchObject({ dueDate: "2026-11-21", dueTime: "15:00", dueTimeZone: "Asia/Riyadh" });
  expect(byTitle("Fallback milestone")).toMatchObject({ dueDate: "2026-11-22", dueTime: "16:00", dueTimeZone: "Asia/Riyadh" });

  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(backup.tasks.find((task: { title: string }) => task.title === "Milestone")).toMatchObject({ dueDate: "2026-11-21", dueTime: "15:00", dueTimeZone: "Asia/Riyadh" });
  expect(backup.tasks.find((task: { title: string }) => task.title === "Date only")).toMatchObject({ dueDate: "2026-11-18", dueTime: "11:45", dueTimeZone: "Asia/Riyadh" });
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clear" }).click();
  await page.getByRole("textbox", { name: "Type CLEAR" }).fill("CLEAR");
  await page.getByRole("button", { name: "Clear data" }).click();
  expect((await state(page)).tasks).toHaveLength(0);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import" }).click();
  await page.getByRole("dialog", { name: "Import data" }).locator('input[type="file"]').setInputFiles({ name: "deadline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  await page.reload();
  data = await state(page);
  expect(byTitle("Milestone")).toMatchObject({ dueDate: "2026-11-21", dueTime: "15:00", dueTimeZone: "Asia/Riyadh" });
  expect(byTitle("Date only")).toMatchObject({ dueDate: "2026-11-18", dueTime: "11:45", dueTimeZone: "Asia/Riyadh" });
  expect(data.messages[data.selected].length).toBeGreaterThan(0);
});
