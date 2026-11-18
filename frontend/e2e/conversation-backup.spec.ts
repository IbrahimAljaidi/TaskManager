import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

async function state(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
}

async function send(page: Page, message: string) {
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function openData(page: Page, action: "Export" | "Import" | "Clear") {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

async function exportJson(page: Page, selected?: string) {
  await openData(page, "Export");
  if (selected) await page.getByRole("dialog", { name: "Export data" }).getByLabel("Export scope").selectOption({ label: selected });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const stream = await (await download).createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

async function chooseImport(page: Page, backup: unknown) {
  await openData(page, "Import");
  await page.getByRole("dialog", { name: "Import data" }).locator('input[type="file"]').setInputFiles({ name: "taskflow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
}

test("backup restores project and global FlowMate histories with correct ownership", async ({ page }) => {
  let providerCalls = 0;
  await page.route("**/api/agent/turn", async route => {
    providerCalls++;
    const body = route.request().postDataJSON();
    const event = body.continuation ? { type: "delta", text: "Proposal ready for approval." }
      : body.message === "Create project Alpha" ? { type: "tool_request", continuation: "mock-proposal", calls: [{ id: "proposal", function: { name: "propose_project", arguments: JSON.stringify({ name: "Alpha", goal: "Plan reservations", description: "A booking application", tasks: [{ title: "Booking flow", priority: "high", checklist: [{ text: "Confirm table" }] }] }) } }] }
      : { type: "delta", text: body.message === "Beta question" ? "Beta answer." : "Workspace answer." };
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(event) + "\n" + (event.type === "tool_request" ? "" : '{"type":"done"}\n') });
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("unrelated-test-key", "keep"));
  await send(page, "Create project Alpha");
  const proposal = page.getByRole("dialog", { name: "Project proposal" });
  await expect(proposal).toBeVisible();
  await expect.poll(async () => (await state(page)).messages.all.at(-1)?.content).toBe("Proposal ready for approval.");
  await proposal.getByRole("button", { name: "Approve & create project" }).click();
  const alphaId = (await state(page)).selected;
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Beta");
  await page.getByRole("dialog", { name: "New project" }).getByRole("button", { name: "Create project" }).click();
  const betaId = (await state(page)).selected;
  await send(page, "Beta question");
  await expect(page.locator(".bubble.assistant").last()).toContainText("Beta answer.");
  await page.getByRole("button", { name: "All Projects", exact: true }).click();
  await send(page, "Workspace question");
  await expect(page.locator(".bubble.assistant").last()).toContainText("Workspace answer.");

  const selected = await exportJson(page, "Alpha");
  expect(selected.version).toBe(2);
  expect(selected.projects.map((project: { id: string }) => project.id)).toEqual([alphaId]);
  expect(selected.tasks).toHaveLength(1);
  expect(Object.keys(selected.conversations)).toEqual([alphaId]);
  expect(selected.conversations[alphaId].map((message: { content: string }) => message.content)).toEqual([
    "Create project Alpha", "Proposal ready for approval.",
    expect.stringContaining("Approved project proposal: Alpha"),
    "Approved the project proposal.", "Created project Alpha with 1 tasks.",
  ]);
  const all = await exportJson(page);
  expect(all.projects.map((project: { id: string }) => project.id)).toEqual([alphaId, betaId]);
  expect(Object.keys(all.conversations)).toEqual([alphaId, betaId, "all"]);
  expect(all.conversations[betaId].map((message: { content: string }) => message.content)).toEqual(["Beta question", "Beta answer."]);
  expect(all.conversations.all.map((message: { content: string }) => message.content)).toEqual(["Workspace question", "Workspace answer."]);
  expect(JSON.stringify(all)).not.toContain("continuation");
  const original = await state(page);

  await chooseImport(page, selected);
  await expect(page.getByText("Alpha · 1 tasks")).toBeVisible();
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  let restored = await state(page);
  const importedAlphaId = restored.selected;
  expect(importedAlphaId).not.toBe(alphaId);
  expect(restored.projects).toHaveLength(3);
  expect(restored.messages[alphaId]).toEqual(original.messages[alphaId]);
  expect(restored.messages[betaId]).toEqual(original.messages[betaId]);
  expect(restored.messages.all).toEqual(original.messages.all);
  expect(restored.messages[importedAlphaId].map((message: { content: string }) => message.content)).toEqual(original.messages[alphaId].map((message: { content: string }) => message.content));
  expect(new Set(restored.messages[importedAlphaId].map((message: { id: string }) => message.id)).size).toBe(restored.messages[importedAlphaId].length);
  expect(restored.messages[importedAlphaId].every((message: { id: string }) => !original.messages[alphaId].some((old: { id: string }) => old.id === message.id))).toBe(true);
  await page.reload();
  await expect(page.locator(".chat-scroll")).toContainText("Created project Alpha with 1 tasks.");

  const beforeInvalid = await page.evaluate(() => localStorage.getItem("taskflow-v1"));
  await chooseImport(page, { ...all, conversations: { ...all.conversations, orphan: [] } });
  await expect(page.getByRole("dialog", { name: "Import data" }).getByRole("alert")).toContainText("No data was changed");
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(beforeInvalid);
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Cancel" }).click();

  const callsBeforeRestore = providerCalls;
  await openData(page, "Clear");
  const clearDialog = page.getByRole("dialog", { name: "Clear data" });
  const clearInput = clearDialog.getByRole("textbox", { name: "Type CLEAR" });
  const clearButton = clearDialog.getByRole("button", { name: "Clear data" });
  await expect(clearButton).toBeDisabled();
  const beforeCancel = await page.evaluate(() => localStorage.getItem("taskflow-v1"));
  await clearDialog.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => localStorage.getItem("taskflow-v1"))).toBe(beforeCancel);
  await openData(page, "Clear");
  await expect(clearButton).toBeDisabled();
  await clearInput.pressSequentially("WRONG");
  await expect(clearButton).toBeDisabled();
  await clearInput.fill("");
  await clearInput.evaluate(input => { (input as HTMLInputElement).value = "CLEAR"; });
  await expect(clearButton).toBeDisabled();
  await clearInput.press("End");
  await expect(clearButton).toBeEnabled();
  await clearInput.fill("");
  await expect(clearButton).toBeDisabled();
  await clearInput.pressSequentially("CLEAR");
  await expect(clearInput).toHaveValue("CLEAR");
  await expect(clearButton).toBeEnabled();
  await page.screenshot({ path: "../docs/verification/clear-button-enabled-docker.png" });
  await clearButton.click();
  restored = await state(page);
  expect(restored.projects).toEqual([]);
  expect(restored.tasks).toEqual([]);
  expect(restored.messages).toEqual({});
  expect(await page.evaluate(() => localStorage.getItem("unrelated-test-key"))).toBe("keep");
  await chooseImport(page, all);
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  restored = await state(page);
  expect(restored.projects).toHaveLength(2);
  expect(restored.tasks).toHaveLength(1);
  const newAlpha = restored.projects.find((project: { name: string }) => project.name === "Alpha").id;
  const newBeta = restored.projects.find((project: { name: string }) => project.name === "Beta").id;
  expect(newAlpha).not.toBe(alphaId);
  expect(newBeta).not.toBe(betaId);
  expect(restored.messages[newAlpha].map((message: { content: string }) => message.content)).toEqual(all.conversations[alphaId].map((message: { content: string }) => message.content));
  expect(restored.messages[newBeta].map((message: { content: string }) => message.content)).toEqual(["Beta question", "Beta answer."]);
  expect(restored.messages.all.map((message: { content: string }) => message.content)).toEqual(["Workspace question", "Workspace answer."]);
  expect(providerCalls).toBe(callsBeforeRestore);
  await page.reload();
  await expect(page.locator(".chat-scroll")).toContainText("Created project Alpha with 1 tasks.");
  await page.getByRole("button", { name: "Beta" }).click();
  await expect(page.locator(".chat-scroll")).toContainText("Beta question");
  await expect(page.locator(".chat-scroll")).not.toContainText("Create project Alpha");
  await page.getByRole("button", { name: "All Projects", exact: true }).click();
  await expect(page.locator(".chat-scroll")).toContainText("Workspace question");

  const betaOnly = { ...all, projects: all.projects.filter((project: { id: string }) => project.id === betaId), tasks: [], conversations: { [betaId]: [{ ...all.conversations[betaId][0], content: "Restored Beta message" }] } };
  await chooseImport(page, betaOnly);
  await page.getByRole("radio", { name: "Replace Existing" }).check();
  await page.getByRole("textbox", { name: "Type REPLACE" }).fill("REPLACE");
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  restored = await state(page);
  expect(restored.messages[newBeta].map((message: { content: string }) => message.content)).toEqual(["Restored Beta message"]);
  expect(restored.messages[newAlpha].map((message: { content: string }) => message.content)).toEqual(all.conversations[alphaId].map((message: { content: string }) => message.content));
  expect(restored.messages.all.map((message: { content: string }) => message.content)).toEqual(["Workspace question", "Workspace answer."]);
  expect(providerCalls).toBe(callsBeforeRestore);

  const { conversations: _removed, ...oldFields } = selected;
  void _removed;
  await chooseImport(page, { ...oldFields, version: 1 });
  await page.getByRole("dialog", { name: "Import data" }).getByRole("button", { name: "Import", exact: true }).click();
  restored = await state(page);
  expect(restored.messages[restored.selected]).toEqual([]);
  expect(restored.messages[newAlpha]).toHaveLength(all.conversations[alphaId].length);
});
