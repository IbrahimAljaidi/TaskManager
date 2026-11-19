import { z } from "zod";
import type { Message, Project, Task } from "./domain";
import { validDate, validTime, validZone } from "./deadline";

const MAX_BACKUP_BYTES = 8_000_000;
const stamp = z.iso.datetime({ offset: true });
const projectSchema = z.strictObject({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), goal: z.string().max(2000), description: z.string().max(4000), createdAt: stamp, updatedAt: stamp });
const taskSchema = z.strictObject({ id: z.string().min(1).max(100), projectId: z.string().min(1).max(100), title: z.string().trim().min(1).max(160), description: z.string().max(2000), notes: z.string().max(4000), status: z.enum(["todo", "progress", "done"]), priority: z.enum(["low", "medium", "high", "urgent"]), dueDate: z.union([z.literal(""), z.string().refine(validDate)]), dueTime: z.union([z.literal(""), z.string().refine(validTime)]).optional(), dueTimeZone: z.union([z.literal(""), z.string().max(80).refine(validZone)]).optional(), tags: z.array(z.string().max(80)).max(12), checklist: z.array(z.strictObject({ id: z.string().min(1).max(100), text: z.string().max(500), done: z.boolean() })).max(100), order: z.number().finite(), createdAt: stamp, updatedAt: stamp }).refine(task => !!task.dueDate || (!task.dueTime && !task.dueTimeZone));
const messageSchema = z.strictObject({ id: z.string().min(1).max(100), role: z.enum(["user", "assistant"]), content: z.string().max(20_000), at: stamp });
const base = { format: z.literal("taskflow-backup"), exportedAt: stamp, projects: z.array(projectSchema).max(200), tasks: z.array(taskSchema).max(10_000) };
const oldBackupSchema = z.strictObject({ ...base, version: z.literal(1) });
const backupSchema = z.strictObject({ ...base, version: z.literal(2), conversations: z.record(z.string().min(1).max(100), z.array(messageSchema).max(120)) });
export type Backup = z.infer<typeof backupSchema>;

// Export only user-visible chat fields. Stored messages are never changed.
function safeContent(content: string): string {
  return content
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[redacted private key]")
    .replace(/\b(?:OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|TASKFLOW_SIGNING_KEY|API_KEY|PASSWORD|ACCESS_TOKEN|SECRET_KEY)\b["']?\s*[:=]\s*["']?[^\s"',}]+["']?/gi, "[redacted credential]")
    .replace(/\bsk-(?:or-|proj-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted API key]")
    .replace(/\b(?:ghp_|gho_|ghu_|xoxb-|AIza)[A-Za-z0-9_-]{16,}\b/g, "[redacted credential]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, "Bearer [redacted]");
}

function exportedMessages(list: Message[]): Message[] {
  return list.map(message => ({ id: message.id, role: message.role, content: safeContent(message.content), at: message.at }));
}

export function makeBackup(projects: Project[], tasks: Task[], projectId?: string, messages: Record<string, Message[]> = {}): Backup {
  const included = projectId ? projects.filter(project => project.id === projectId) : projects;
  if (projectId && included.length !== 1) throw new Error("Project is no longer available.");
  const ids = new Set(included.map(project => project.id));
  const conversations: Record<string, Message[]> = {};
  for (const project of included) conversations[project.id] = exportedMessages(messages[project.id] || []);
  if (!projectId && messages.all?.length) conversations.all = exportedMessages(messages.all);
  const backup = backupSchema.parse({ format: "taskflow-backup", version: 2, exportedAt: new Date().toISOString(), projects: included, tasks: tasks.filter(task => ids.has(task.projectId)), conversations });
  if (new TextEncoder().encode(JSON.stringify(backup)).length > MAX_BACKUP_BYTES) throw new Error("This backup is too large.");
  return backup;
}

export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error("This backup is too large.");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("This is not a valid JSON file."); }
  const current = backupSchema.safeParse(raw);
  const older = current.success ? null : oldBackupSchema.safeParse(raw);
  if (!current.success && !older?.success) throw new Error("This file is not a supported TaskFlow backup (version 1 or 2). Check its contents and try again.");
  const backup = current.success ? current.data : backupSchema.parse({ ...older!.data, version: 2, conversations: {} });
  const projects = new Set(backup.projects.map(project => project.id));
  const tasks = new Set(backup.tasks.map(task => task.id));
  if (projects.has("all") || projects.has("__proto__") || projects.has("constructor") || projects.size !== backup.projects.length || tasks.size !== backup.tasks.length || backup.tasks.some(task => !projects.has(task.projectId) || new Set(task.checklist.map(item => item.id)).size !== task.checklist.length)) throw new Error("This backup has duplicate IDs or tasks without a project.");
  const messageIds = new Set<string>();
  for (const [owner, conversation] of Object.entries(backup.conversations)) {
    if (owner !== "all" && !projects.has(owner)) throw new Error("This backup has a conversation without its project.");
    for (const message of conversation) {
      if (messageIds.has(message.id)) throw new Error("This backup has duplicate message IDs.");
      messageIds.add(message.id);
    }
  }
  return backup;
}

export function backupFilename(project?: Project) {
  const slug = project?.name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return slug ? `taskflow-${slug}.json` : "taskflow-backup.json";
}
