import type { Task } from "./domain";

export const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const validTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

export function deadlineLabel(task: Pick<Task, "dueDate" | "dueTime" | "dueTimeZone">): string {
  return task.dueDate ? `${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}${task.dueTimeZone ? ` ${task.dueTimeZone}` : ""}` : "";
}

export function isOverdue(task: Pick<Task, "dueDate" | "dueTime" | "dueTimeZone" | "status">, now = new Date()): boolean {
  if (task.status === "done" || !task.dueDate) return false;
  const zone = task.dueTimeZone && validZone(task.dueTimeZone) ? task.dueTimeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  if (task.dueDate !== today) return task.dueDate < today;
  return !!task.dueTime && `${part("hour")}:${part("minute")}` >= task.dueTime;
}

const englishMonths: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
const arabicMonths: Record<string, string> = { يناير: "01", فبراير: "02", مارس: "03", أبريل: "04", ابريل: "04", مايو: "05", يونيو: "06", يوليو: "07", أغسطس: "08", اغسطس: "08", سبتمبر: "09", أكتوبر: "10", اكتوبر: "10", نوفمبر: "11", ديسمبر: "12" };
export type ParsedDeadline = { dueDate: string; dueTime?: string; dueTimeZone?: string };
export function parseExplicitDeadline(text: string): ParsedDeadline | "ambiguous" | null {
  const normalized = text.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  if (!/\b(?:due|deadline|by|before)\b|(?:موعد|بحلول|قبل|تاريخ الاستحقاق)/i.test(normalized)) return null;
  let dueDate = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "";
  if (!dueDate) {
    const english = normalized.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
    const arabic = normalized.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+(\d{4})/);
    const found = english || arabic;
    if (found) dueDate = `${found[3]}-${(english ? englishMonths[found[2].toLowerCase()] : arabicMonths[found[2]])}-${found[1].padStart(2, "0")}`;
  }
  if (!dueDate) return /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(normalized) ? "ambiguous" : null;
  if (!validDate(dueDate)) return "ambiguous";
  const clock = normalized.match(/(?:\bat\s*|الساعة\s*)(\d{1,2})(?::([0-5]\d))?\s*(AM|PM|صباحًا|صباحا|مساءً|مساء|م)?/i);
  let dueTime: string | undefined;
  if (clock) {
    let hour = Number(clock[1]);
    const pm = /^(pm|مساء)/i.test(clock[3] || "");
    const am = /^(am|صباح)/i.test(clock[3] || "");
    if (hour > 23 || ((pm || am) && hour > 12)) return "ambiguous";
    if (pm && hour < 12) hour += 12;
    if (am && hour === 12) hour = 0;
    dueTime = `${String(hour).padStart(2, "0")}:${clock[2] || "00"}`;
  }
  const dueTimeZone = normalized.match(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0];
  if (dueTimeZone && !validZone(dueTimeZone)) return "ambiguous";
  return { dueDate, ...(dueTime ? { dueTime } : {}), ...(dueTimeZone ? { dueTimeZone } : {}) };
}
