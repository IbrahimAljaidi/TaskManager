import type { Message, Proposal } from "./domain";

// The agent only receives the recent conversation window. Within that window,
// anchor a proposal to the latest explicit project-creation request so older
// workspace questions remain in the global chat.
export function proposalStartId(messages: Message[], name: string): string | null {
  const recent = messages.slice(-13);
  const creationIntent = /\b(?:create|build|develop|plan|start|launch|make|design|set up|i want|i need|help me|could you)\b[\s\S]{0,160}\b(?:project|app|application|website|platform|product|service|system|bot|restaurant|reservation|business)\b|(?:أنشئ|انشئ|إنشاء|اصنع|ابن|بناء|خطط|تخطيط|أريد)[\s\S]{0,160}(?:مشروع|تطبيق|موقع|منصة|نظام|مطعم|حجز)/i;
  const explicit = recent.findLastIndex(message => message.role === "user" && creationIntent.test(message.content));
  if (explicit >= 0) return recent[explicit].id;
  const named = recent.findLastIndex(message => message.role === "user" && name.length >= 4 && message.content.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (named >= 0) return recent[named].id;
  return recent.findLast(message => message.role === "user")?.id ?? null;
}

export function proposalSummary(proposal: Proposal, language: "en" | "ar"): string {
  const tasks = proposal.tasks.map((task, index) => `${index + 1}. ${task.title} (${task.priority || "medium"})${task.dueDate ? ` [${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}${task.dueTimeZone ? ` ${task.dueTimeZone}` : ""}]` : ""}${task.description ? ` — ${task.description}` : ""}${task.checklist?.length ? `\n   ${task.checklist.map(item => `☐ ${item.text}`).join(" · ")}` : ""}`).join("\n");
  return language === "ar"
    ? `مقترح المشروع المعتمد: ${proposal.name}\nالهدف: ${proposal.goal}\nالوصف: ${proposal.description}\nالمهام:\n${tasks}`
    : `Approved project proposal: ${proposal.name}\nGoal: ${proposal.goal}\nDescription: ${proposal.description}\nTasks:\n${tasks}`;
}
