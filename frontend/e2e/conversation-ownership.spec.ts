import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

async function send(page: Page, message: string) {
  await page.getByRole("textbox", { name: "Ask FlowMate" }).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function stored(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("taskflow-v1")!).state);
}

test("approved creation moves only its thread to the new project ID and persists", async ({ page }) => {
  const requests: { scope: string; message: string; history: { content: string }[]; tasks: { projectId: string }[] }[] = [];
  await page.route("**/api/agent/turn", async route => {
    const body = route.request().postDataJSON();
    requests.push({ scope: body.scope, message: body.message, history: body.history, tasks: body.tasks });
    let event: { type: string; [key: string]: unknown };
    if (body.continuation) event = { type: "delta", text: "The editable proposal is ready." };
    else if (body.message.includes("restaurant details")) event = { type: "tool_request", continuation: "restaurant-continuation", calls: [{ id: "restaurant-proposal", function: { name: "propose_project", arguments: JSON.stringify({ name: "Smart Restaurant QA", goal: "Restaurant reservations", description: "A responsive reservation application with an AI assistant", tasks: Array.from({ length: 8 }, (_, index) => ({ title: `Restaurant task ${index + 1}`, priority: index ? "medium" : "high" })) }) } }] };
    else if (body.message.includes("Graduation QA")) event = { type: "tool_request", continuation: "graduation-continuation", calls: [{ id: "graduation-proposal", function: { name: "propose_project", arguments: JSON.stringify({ name: "Graduation QA", goal: "Finish a thesis", description: "Research and delivery plan", tasks: [{ title: "Write outline", priority: "high" }] }) } }] };
    else event = { type: "delta", text: body.message.includes("workspace status") ? "Your workspace is ready." : body.message.includes("Existing task") ? "The existing task is on track." : body.message.includes("Next restaurant step") ? "Start with the booking flow." : "What should the restaurant include?" };
    const lines = [JSON.stringify(event), ...(event.type === "tool_request" ? [] : ['{"type":"done"}'])];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.join("\n") + "\n" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create project", exact: true }).first().click();
  await page.getByRole("dialog", { name: "New project" }).getByLabel("Project name").fill("Existing project");
  await page.getByRole("dialog", { name: "New project" }).getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByRole("dialog", { name: "Create task" }).getByLabel("Task title").fill("Existing task");
  await page.getByRole("dialog", { name: "Create task" }).getByRole("button", { name: "Save task" }).click();
  await send(page, "How is Existing task doing?");
  await expect(page.locator(".bubble.assistant")).toContainText("The existing task is on track.");
  const existing = await stored(page);
  const existingId = existing.projects[0].id;
  const existingTaskId = existing.tasks[0].id;

  await page.getByRole("button", { name: "All Projects", exact: true }).click();
  await send(page, "What is my workspace status?");
  await expect(page.locator(".bubble.assistant")).toContainText("Your workspace is ready.");
  await send(page, "Create a project for restaurant reservations");
  await expect(page.locator(".bubble.assistant").last()).toContainText("What should the restaurant include?");
  await send(page, "The restaurant details are bookings, owner tables, AI requests, and a three-month timeline.");
  const proposal = page.getByRole("dialog", { name: "Project proposal" });
  await expect(proposal).toBeVisible();
  await expect.poll(async () => (await stored(page)).messages.all.at(-1)?.content).toBe("The editable proposal is ready.");
  let state = await stored(page);
  expect(state.projects).toHaveLength(1);
  expect(state.messages.all).toHaveLength(6);
  await proposal.getByRole("button", { name: "Approve & create project" }).click();
  state = await stored(page);
  expect(state.projects).toHaveLength(2);
  const restaurant = state.projects.find((p: { name: string }) => p.name === "Smart Restaurant QA");
  expect(restaurant).toBeTruthy();
  expect(state.tasks.filter((task: { projectId: string }) => task.projectId === restaurant.id)).toHaveLength(8);
  expect(state.messages.all.map((m: { content: string }) => m.content)).toEqual(["What is my workspace status?", "Your workspace is ready."]);
  const creationHistory = state.messages[restaurant.id];
  expect(creationHistory.map((m: { content: string }) => m.content)).toEqual([
    "Create a project for restaurant reservations",
    "What should the restaurant include?",
    "The restaurant details are bookings, owner tables, AI requests, and a three-month timeline.",
    "The editable proposal is ready.",
    expect.stringContaining("Approved project proposal: Smart Restaurant QA"),
    "Approved the project proposal.",
    "Created project Smart Restaurant QA with 8 tasks.",
  ]);
  expect(new Set(creationHistory.map((m: { id: string }) => m.id)).size).toBe(creationHistory.length);
  expect(state.projects.find((p: { id: string }) => p.id === existingId)).toBeTruthy();
  expect(state.tasks.find((t: { id: string }) => t.id === existingTaskId)).toBeTruthy();
  expect(state.messages[existingId].map((m: { content: string }) => m.content)).toEqual(["How is Existing task doing?", "The existing task is on track."]);

  await page.getByRole("button", { name: "All Projects", exact: true }).click();
  await expect(page.locator(".chat-scroll")).toContainText("Your workspace is ready.");
  await expect(page.locator(".chat-scroll")).not.toContainText("restaurant reservations");
  await page.getByRole("button", { name: "Smart Restaurant QA" }).click();
  await expect(page.locator(".chat-scroll")).toContainText("Create a project for restaurant reservations");
  await expect(page.locator(".chat-scroll")).toContainText("Created project Smart Restaurant QA with 8 tasks.");
  await send(page, "Next restaurant step?");
  await expect(page.locator(".bubble.assistant").last()).toContainText("Start with the booking flow.");
  const followup = requests.findLast(request => request.message === "Next restaurant step?");
  expect(followup?.scope).toBe(restaurant.id);
  expect(followup?.history.some(item => item.content.includes("Created project Smart Restaurant QA"))).toBe(true);
  expect(followup?.tasks).toHaveLength(8);
  expect(followup?.tasks.every(task => task.projectId === restaurant.id)).toBe(true);
  await page.reload();
  await expect(page.locator(".chat-scroll")).toContainText("Next restaurant step?");
  await expect(page.locator(".chat-scroll")).toContainText("Start with the booking flow.");

  await page.getByRole("button", { name: "All Projects", exact: true }).click();
  await send(page, "Create a project called Graduation QA");
  await expect(page.getByRole("dialog", { name: "Project proposal" })).toBeVisible();
  await expect.poll(async () => (await stored(page)).messages.all.at(-1)?.content).toBe("The editable proposal is ready.");
  await page.getByRole("dialog", { name: "Project proposal" }).getByRole("button", { name: "Approve & create project" }).click();
  state = await stored(page);
  const graduation = state.projects.find((p: { name: string }) => p.name === "Graduation QA");
  expect(graduation).toBeTruthy();
  expect(state.messages[graduation.id].map((m: { content: string }) => m.content)).toContain("Create a project called Graduation QA");
  expect(state.messages[graduation.id].some((m: { content: string }) => m.content.includes("restaurant reservations"))).toBe(false);
  expect(state.messages[restaurant.id].some((m: { content: string }) => m.content === "Next restaurant step?")).toBe(true);
  expect(state.messages.all.map((m: { content: string }) => m.content)).toEqual(["What is my workspace status?", "Your workspace is ready."]);
  await page.getByRole("button", { name: "Existing project" }).click();
  await expect(page.locator(".chat-scroll")).toContainText("How is Existing task doing?");
  await expect(page.locator(".chat-scroll")).not.toContainText("Graduation QA");
});

test("a saved proposal without origin metadata migrates without deleting earlier chat", async ({ page }) => {
  const stamp = "2026-11-17T00:00:00.000Z";
  await page.addInitScript(({ stamp }) => {
    if (sessionStorage.getItem("legacy-seeded")) return;
    sessionStorage.setItem("legacy-seeded", "true");
    localStorage.setItem("taskflow-v1", JSON.stringify({ version: 1, state: {
      projects: [], tasks: [], selected: "all", theme: "dark", version: 0,
      messages: { all: [
        { id: "old-user", role: "user", content: "What is my workspace status?", at: stamp },
        { id: "old-assistant", role: "assistant", content: "Everything is ready.", at: stamp },
        { id: "creation-user", role: "user", content: "Create a project called Legacy QA", at: stamp },
        { id: "creation-assistant", role: "assistant", content: "Here is the proposal.", at: stamp },
      ] },
      proposal: { name: "Legacy QA", goal: "Check migration", description: "A saved proposal", tasks: [{ title: "Verify data" }] },
    } }));
  }, { stamp });
  await page.goto("/");
  const proposal = page.getByRole("dialog", { name: "Project proposal" });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Approve & create project" }).click();
  let state = await stored(page);
  const id = state.projects[0].id;
  expect(state.messages.all.map((m: { id: string }) => m.id)).toEqual(["old-user", "old-assistant"]);
  expect(state.messages[id].slice(0, 2).map((m: { id: string }) => m.id)).toEqual(["creation-user", "creation-assistant"]);
  await page.reload();
  await expect(page.locator(".chat-scroll")).toContainText("Create a project called Legacy QA");
  await page.getByRole("button", { name: "Edit project" }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "Delete project" }).click();
  state = await stored(page);
  expect(state.messages[id]).toBeUndefined();
  expect(state.messages.all.map((m: { id: string }) => m.id)).toEqual(["old-user", "old-assistant"]);
});
