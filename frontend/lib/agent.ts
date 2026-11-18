import { z } from "zod";
import { blankTask, now, type Proposal, type Task } from "./domain";
import { parseExplicitDeadline, validDate, validTime, validZone } from "./deadline";
import { useStore } from "./store";
const api = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const statusSchema = z.enum(["todo", "progress", "done"]);
const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const dateSchema = z.union([z.literal(""), z.string().refine(validDate)]);
const timeSchema = z.union([z.literal(""), z.string().refine(validTime)]);
const zoneSchema = z.union([z.literal(""), z.string().max(80).refine(validZone)]);
const proposedTaskSchema = z.object({ title: z.string().min(1).max(160), description: z.string().optional(), priority: prioritySchema.optional(), dueDate: dateSchema.optional(), dueTime: timeSchema.optional(), dueTimeZone: zoneSchema.optional(), checklist: z.array(z.object({ text: z.string(), done: z.boolean().optional() })).optional() }).refine(task => !!task.dueDate || (!task.dueTime && !task.dueTimeZone));
const proposalSchema = z.object({ name: z.string().min(1).max(100), goal: z.string().max(1000), description: z.string().max(2000), tasks: z.array(proposedTaskSchema).max(30) });
type AgentEvent = { type: string; code?: string; correlationId?: string; text?: string; calls?: { id: string; function: { name: string; arguments: string } }[]; continuation?: string };
export type Trace = { id: string; name: string; status: "pending" | "done" | "failed"; detail: string };
export type AgentPhase = "thinking" | "responding" | "executing" | "idle";
export class AgentFailure extends Error {
  constructor(public code: string, public correlationId?: string, public changed = false) { super(code); }
}
const toolCallSchema = z.object({ id: z.string().min(1).max(128), function: z.object({ name: z.enum(["list_tasks", "create_task", "update_task", "move_task", "delete_task", "batch_update", "propose_project"]), arguments: z.string().max(20_000) }) });
const eventSchema = z.object({ type: z.enum(["status", "delta", "tool_request", "done", "error"]), code: z.string().optional(), correlationId: z.string().optional(), text: z.string().optional(), calls: z.array(toolCallSchema).max(5).optional(), continuation: z.string().optional() });
export function friendlyError(error: unknown, input: string): string {
  const arabic = /[\u0600-\u06ff]/.test(input);
  const code = error instanceof AgentFailure ? error.code : "NETWORK_ERROR";
  const changed = error instanceof AgentFailure && error.changed;
  const reference = error instanceof AgentFailure && error.correlationId ? (arabic ? ` (المرجع: ${error.correlationId})` : ` (reference: ${error.correlationId})`) : "";
  if (changed) return (arabic ? "اكتملت بعض الإجراءات، لكن تعذر إكمال الطلب. راجع التغييرات وحاول مرة أخرى." : "Some actions completed, but the request could not finish. Review the changes and try again.") + reference;
  if (["AGENT_UNAVAILABLE", "AUTH_FAILED", "PROVIDER_RATE_LIMIT", "RATE_LIMITED", "NETWORK_ERROR", "TIMEOUT"].includes(code)) return (arabic ? "تعذر الاتصال بالمساعد حاليًا. حاول مرة أخرى." : "The assistant is temporarily unavailable. Please try again.") + reference;
  if (["INVALID_TOOL_CALL", "OUTPUT_TRUNCATED", "MALFORMED_RESPONSE", "STREAM_INCOMPLETE", "EMPTY_RESPONSE"].includes(code)) return (arabic ? "لم أتمكن من إكمال العملية. لم يتم تطبيق أي تغييرات." : "The operation could not be completed. No changes were applied.") + reference;
  return (arabic ? "حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى." : "Something went wrong while processing your request. Please try again.") + reference;
}
export class ToolExecutionFailure extends Error {
  constructor(public code: "TASK_NOT_FOUND" | "TASK_AMBIGUOUS" | "AMBIGUOUS_DEADLINE" | "INVALID_ARGUMENTS" | "STORE_UPDATE_FAILED") { super(code); }
}
function findTask(identifier: string, scope: string): Task {
  const tasks = useStore.getState().tasks.filter(task => scope === "all" || task.projectId === scope);
  const normalized = identifier.trim().toLocaleLowerCase();
  const byId = tasks.find(task => task.id === identifier);
  // A model may pass the displayed title in taskId. Resolve it only when it is unique
  // within the selected project, then mutate by the authoritative browser ID.
  const matches = byId ? tasks.filter(task => task.projectId === byId.projectId && task.title.trim().toLocaleLowerCase() === byId.title.trim().toLocaleLowerCase())
    : tasks.filter(task => task.title.trim().toLocaleLowerCase() === normalized);
  if (!matches.length) throw new ToolExecutionFailure("TASK_NOT_FOUND");
  if (matches.length !== 1) throw new ToolExecutionFailure("TASK_AMBIGUOUS");
  return matches[0];
}
function withDeadline(args: Record<string, unknown>, request = ""): Record<string, unknown> {
  if (/\b(?:remove|clear|delete)\s+(?:the\s+)?(?:due date|deadline)\b|(?:احذف|أزل|امسح)\s+(?:موعد|تاريخ الاستحقاق)/i.test(request)) return { ...args, dueDate: "", dueTime: "", dueTimeZone: "" };
  const parsed = parseExplicitDeadline(typeof args.description === "string" ? args.description : "") || parseExplicitDeadline(request);
  if (parsed === "ambiguous") throw new ToolExecutionFailure("AMBIGUOUS_DEADLINE");
  if (!parsed) return args;
  if (args.dueDate === "") return { ...args, ...parsed };
  if (args.dueDate !== undefined) return parsed.dueDate === args.dueDate ? { ...parsed, ...args } : args;
  return { ...args, ...parsed };
}
function safePatch(t: Task, raw: Record<string, unknown>, request = ""): Task {
  const args = withDeadline(raw, request);
  const dueDate = args.dueDate === undefined ? t.dueDate : dateSchema.parse(args.dueDate);
  if (!dueDate && (args.dueTime || args.dueTimeZone)) throw new ToolExecutionFailure("INVALID_ARGUMENTS");
  const dateChanged = args.dueDate !== undefined && dueDate !== t.dueDate;
  const dueTime = !dueDate ? "" : args.dueTime === undefined ? dateChanged ? "" : t.dueTime || "" : timeSchema.parse(args.dueTime);
  const dueTimeZone = !dueDate ? "" : args.dueTimeZone === undefined ? dateChanged ? "" : t.dueTimeZone || "" : zoneSchema.parse(args.dueTimeZone);
  return { ...t, title: args.title === undefined ? t.title : z.string().min(1).max(160).parse(args.title), description: args.description === undefined ? t.description : z.string().max(2000).parse(args.description), notes: args.notes === undefined ? t.notes : z.string().max(4000).parse(args.notes), priority: args.priority === undefined ? t.priority : prioritySchema.parse(args.priority), dueDate, dueTime, dueTimeZone, tags: args.tags === undefined ? t.tags : z.array(z.string().max(30)).max(12).parse(args.tags), checklist: args.checklist === undefined ? t.checklist : z.array(z.object({ id: z.string().optional(), text: z.string().min(1).max(200), done: z.boolean().optional() })).max(30).parse(args.checklist).map(c => ({ id: c.id || crypto.randomUUID(), text: c.text, done: !!c.done })), updatedAt: now() };
}
export async function executeTool(name: string, args: Record<string, unknown>, scope: string, request = ""): Promise<unknown> {
  const s = useStore.getState();
  if (name === "list_tasks") { const query = z.string().max(100).optional().parse(args.query)?.toLowerCase() || ""; return s.tasks.filter(t => (scope === "all" || t.projectId === scope) && (!query || (t.title + t.description + t.tags.join(" ")).toLowerCase().includes(query))).slice(0, 100); }
  if (name === "propose_project") { const raw = proposalSchema.parse(args); const p: Proposal = { ...raw, tasks: raw.tasks.map(task => proposedTaskSchema.parse(withDeadline(task, raw.tasks.length === 1 ? request : ""))) }; s.setProposal(p, scope); return { status: "proposed", message: "Editable project preview shown. Creation awaits human approval." }; }
  if (scope === "all") throw Error("Select a project before changing tasks");
  if (s.selected !== scope) throw new ToolExecutionFailure("INVALID_ARGUMENTS");
  if (name === "create_task") { const title = z.string().min(1).max(160).parse(args.title); const t = safePatch(blankTask(scope, title), args, request); s.upsertTask(t); return { id: t.id, title: t.title, status: t.status }; }
  if (name === "update_task") { const t = findTask(z.string().parse(args.taskId), scope); const updated = safePatch(t, args, request); s.upsertTask(updated); if (!useStore.getState().tasks.some(task => task.id === t.id && task.priority === updated.priority && task.title === updated.title && task.dueDate === updated.dueDate && task.dueTime === updated.dueTime && task.dueTimeZone === updated.dueTimeZone)) throw new ToolExecutionFailure("STORE_UPDATE_FAILED"); return { id: t.id, updated: true }; }
  if (name === "move_task") { const t = findTask(z.string().parse(args.taskId), scope); const status = statusSchema.parse(args.status); s.reorder(t.id, status); if (useStore.getState().tasks.find(task => task.id === t.id)?.status !== status) throw new ToolExecutionFailure("STORE_UPDATE_FAILED"); return { id: t.id, status }; }
  if (name === "delete_task") { const t = findTask(z.string().parse(args.taskId), scope); if (!window.confirm("Delete task: " + t.title + "? This cannot be undone.")) return { approved: false }; s.removeTask(t.id); return { id: t.id, deleted: true, approved: true }; }
  if (name === "batch_update") { const ids = z.array(z.string()).min(1).max(30).parse(args.taskIds); if (new Set(ids).size !== ids.length) throw Error("Duplicate task IDs"); const tasks = ids.map(id => findTask(id, scope)); const status = args.status ? statusSchema.parse(args.status) : undefined; const tag = args.addTag ? z.string().min(1).max(30).parse(args.addTag) : undefined; if (!status && !tag) throw Error("No batch changes requested"); if (!window.confirm("Apply changes to " + tasks.length + " tasks?\n" + tasks.map(t => "• " + t.title).join("\n") + "\n" + (status ? "Status: " + status + " " : "") + (tag ? "Add tag: " + tag : ""))) return { approved: false }; s.batchUpdate(ids, status, tag); return { approved: true, updated: ids }; }
  throw Error("Unsupported tool");
}
async function readLines(response: Response, onEvent: (e: AgentEvent) => void) {
  if (!response.ok || !response.body) throw new AgentFailure(response.status === 429 ? "RATE_LIMITED" : "AGENT_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  const parse = (line: string) => {
    let event: AgentEvent;
    try { event = eventSchema.parse(JSON.parse(line)); }
    catch { throw new AgentFailure("MALFORMED_RESPONSE"); }
    if (terminal) throw new AgentFailure("MALFORMED_RESPONSE");
    onEvent(event);
    if (["done", "tool_request", "error"].includes(event.type)) terminal = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 120_000) throw new AgentFailure("MALFORMED_RESPONSE");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) parse(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parse(buffer);
    if (!terminal) throw new AgentFailure("STREAM_INCOMPLETE");
  } finally { reader.releaseLock(); }
}
function actionDetail(name: string, args: Record<string, unknown>, scope: string, arabic: boolean): string {
  const taskId = typeof args.taskId === "string" ? args.taskId : "";
  const task = useStore.getState().tasks.find(item => item.id === taskId && (scope === "all" || item.projectId === scope));
  const title = (task?.title || (typeof args.title === "string" ? args.title : "")).slice(0, 80);
  const action: Record<string, [string, string]> = {
    list_tasks: ["Reading project tasks", "قراءة مهام المشروع"],
    create_task: [`Creating task ${title}`, `إنشاء المهمة ${title}`],
    update_task: [`Updating task ${title}`, `تحديث المهمة ${title}`],
    move_task: [`Moving ${title} to ${args.status === "done" ? "Done" : args.status === "progress" ? "In Progress" : "To Do"}`, `نقل ${title} إلى ${args.status === "done" ? "منجز" : args.status === "progress" ? "قيد التنفيذ" : "للتنفيذ"}`],
    delete_task: [`Deleting task ${title} after approval`, `حذف المهمة ${title} بعد الموافقة`],
    batch_update: ["Applying approved changes to tasks", "تطبيق التغييرات المعتمدة على المهام"],
    propose_project: ["Preparing an editable project proposal", "إعداد مقترح مشروع قابل للتعديل"],
  };
  return (action[name] || ["Working with project data", "العمل على بيانات المشروع"])[arabic ? 1 : 0];
}
export async function runAgent(message: string, scope: string, onText: (v: string) => void, onTrace: (t: Trace) => void, onPhase: (phase: AgentPhase) => void = () => {}, signal?: AbortSignal): Promise<string> {
  let content = "", continuation: string | undefined, results: Record<string, unknown>[] = [];
  let changed = false;
  let toolFailure: ToolExecutionFailure["code"] | null = null;
  const arabic = /[\u0600-\u06ff]/.test(message);
  const prior = (useStore.getState().messages[scope] || []).slice(-13);
  if (prior.at(-1)?.role === "user" && prior.at(-1)?.content === message) prior.pop();
  const initialHistory = prior.slice(-12).map(m => ({ role: m.role, content: m.content }));
  for (let step = 0; step < 4; step++) {
    if (signal?.aborted) throw new AgentFailure("CANCELLED", undefined, changed);
    onPhase("thinking");
    const s = useStore.getState();
    const body = { message, scope, projects: s.projects.map(p => ({ id: p.id, name: p.name, goal: p.goal })), tasks: s.tasks.filter(t => scope === "all" || t.projectId === scope).slice(0, 60).map(t => ({ id: t.id, projectId: t.projectId, title: t.title, description: t.description.slice(0, 200), notes: t.notes.slice(0, 100), status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime || "", dueTimeZone: t.dueTimeZone || "", tags: t.tags, checklist: t.checklist.slice(0, 10) })), history: continuation ? [] : initialHistory, version: s.version, continuation, results };
    let request: AgentEvent | undefined, error: AgentFailure | undefined, completed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65000);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(api + "/api/agent/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      await readLines(response, e => { if (e.type === "status" && e.code === "THINKING") onPhase("thinking"); if (e.type === "delta") { content += e.text || ""; if (e.text) onPhase("responding"); if (!toolFailure) onText(content); } if (e.type === "tool_request") { request = e; onPhase("executing"); } if (e.type === "done") completed = true; if (e.type === "error") error = new AgentFailure(e.code || "INTERNAL_ERROR", e.correlationId, changed); });
    } catch (cause) {
      if (cause instanceof AgentFailure) throw new AgentFailure(cause.code, cause.correlationId, changed);
      throw new AgentFailure(signal?.aborted ? "CANCELLED" : controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR", undefined, changed);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
    if (error) throw error;
    if (completed) {
      if (toolFailure && changed) return arabic ? "اكتملت بعض الإجراءات، لكن تعذر تطبيق تغيير آخر. راجع المهام وحاول مرة أخرى." : "Some actions completed, but another change could not be applied. Please review the tasks and try again.";
      if (toolFailure === "TASK_AMBIGUOUS") return arabic ? "توجد أكثر من مهمة بهذا الاسم. حدّد المهمة المقصودة بتفصيل إضافي." : "More than one task has that name. Please clarify which task you mean.";
      if (toolFailure === "TASK_NOT_FOUND") return arabic ? "لم أجد هذه المهمة في المشروع المحدد. تحقق من الاسم وحاول مرة أخرى." : "I couldn't find that task in the selected project. Please check the name and try again.";
      if (toolFailure === "AMBIGUOUS_DEADLINE") return arabic ? "يرجى توضيح موعد الاستحقاق بذكر اليوم والشهر والسنة، مثل 18 نوفمبر 2026." : "Please clarify the deadline with the day, month, and year, such as 18 November 2026.";
      if (toolFailure) return arabic ? "تعذر تطبيق التغيير. تحقق من المهمة وحاول مرة أخرى." : "I couldn't apply that change. Please check the task and try again.";
      return content;
    }
    if (!request?.continuation || !request.calls?.length) throw new AgentFailure("MALFORMED_RESPONSE", undefined, changed);
    const req = request as AgentEvent;
    continuation = req.continuation;
    results = [];
    for (const call of req.calls || []) {
      const name = call.function.name;
      let detail = arabic ? "جارٍ تنفيذ الإجراء" : "Executing action";
      try {
        const args = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid arguments");
        detail = actionDetail(name, args, scope, arabic);
        onTrace({ id: call.id, name, status: "pending", detail });
        const value = await executeTool(name, args, scope, message);
        const approved = !(typeof value === "object" && value !== null && "approved" in value && value.approved === false);
        if (approved && !["list_tasks", "propose_project"].includes(name)) changed = true;
        results.push({ id: call.id, name, success: approved, value });
        onTrace({ id: call.id, name, status: approved ? "done" : "failed", detail: approved ? detail : (arabic ? "لم تتم الموافقة على الإجراء" : "Approval declined") });
      } catch (cause) {
        const code = cause instanceof ToolExecutionFailure ? cause.code : "INVALID_ARGUMENTS";
        toolFailure = code;
        console.warn("flowmate_tool_failure", { name, code });
        results.push({ id: call.id, name, success: false, error: code });
        onTrace({ id: call.id, name, status: "failed", detail: code === "TASK_AMBIGUOUS" ? (arabic ? "يرجى تحديد المهمة المقصودة" : "Please clarify which task you mean") : (arabic ? "تعذر تنفيذ الإجراء" : "Action could not be completed") });
      }
    }
  }
  throw new AgentFailure("STEP_LIMIT", undefined, changed);
}
