import { describe, expect, it } from "vitest";
import { isOverdue, parseExplicitDeadline, validDate } from "./deadline";

describe("structured task deadlines", () => {
  it("parses English and Arabic dates, time, and an IANA zone without UTC conversion", () => {
    expect(parseExplicitDeadline("Requirements Analysis — due 18 November 2026 at 5:00 PM, Asia/Riyadh.")).toEqual({ dueDate: "2026-11-18", dueTime: "17:00", dueTimeZone: "Asia/Riyadh" });
    expect(parseExplicitDeadline("تحليل المتطلبات موعده ١٨ نوفمبر ٢٠٢٦ الساعة ٥ مساءً Asia/Riyadh")).toEqual({ dueDate: "2026-11-18", dueTime: "17:00", dueTimeZone: "Asia/Riyadh" });
    expect(parseExplicitDeadline("Due 2026-11-18")).toEqual({ dueDate: "2026-11-18" });
    expect(parseExplicitDeadline("Due 18/11/2026")).toBe("ambiguous");
    expect(validDate("2026-02-30")).toBe(false);
  });

  it("checks date-only deadlines after the local date and timed deadlines after the local time", () => {
    const due = { status: "todo" as const, dueDate: "2026-11-18", dueTimeZone: "Asia/Riyadh" };
    expect(isOverdue(due, new Date("2026-11-18T20:59:00Z"))).toBe(false);
    expect(isOverdue(due, new Date("2026-11-18T21:01:00Z"))).toBe(true);
    expect(isOverdue({ ...due, dueTime: "17:00" }, new Date("2026-11-18T13:59:00Z"))).toBe(false);
    expect(isOverdue({ ...due, dueTime: "17:00" }, new Date("2026-11-18T14:00:00Z"))).toBe(true);
    expect(isOverdue({ ...due, dueTime: "17:00" }, new Date("2026-11-18T14:01:00Z"))).toBe(true);
    expect(isOverdue({ ...due, status: "done" }, new Date("2026-11-19T00:00:00Z"))).toBe(false);
  });
});
