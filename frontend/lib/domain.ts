export type Status = "todo" | "progress" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type ChecklistItem = { id: string; text: string; done: boolean };
export type Project = { id: string; name: string; goal: string; description: string; createdAt: string; updatedAt: string };
export type Task = { id: string; projectId: string; title: string; description: string; notes: string; status: Status; priority: Priority; dueDate: string; tags: string[]; checklist: ChecklistItem[]; order: number; createdAt: string; updatedAt: string };
export type Message = { id: string; role: "user" | "assistant"; content: string; at: string };
export type Proposal = { name: string; goal: string; description: string; tasks: { title: string; description?: string; priority?: Priority; checklist?: { text: string; done?: boolean }[] }[] };
export const statuses: Status[] = ["todo", "progress", "done"];
export const labels: Record<Status, string> = { todo: "To Do", progress: "In Progress", done: "Done" };
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const blankTask = (projectId: string, title = ""): Task => ({ id: uid(), projectId, title, description: "", notes: "", status: "todo", priority: "medium", dueDate: "", tags: [], checklist: [], order: Date.now(), createdAt: now(), updatedAt: now() });
export function analytics(tasks: Task[]) { const total = tasks.length, done = tasks.filter(t => t.status === "done").length, overdue = tasks.filter(t => t.status !== "done" && !!t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length; return { total, done, overdue, progress: total ? Math.round(done / total * 100) : 0, todo: tasks.filter(t => t.status === "todo").length, active: tasks.filter(t => t.status === "progress").length }; }
