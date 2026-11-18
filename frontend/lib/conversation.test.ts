import { describe, expect, it } from "vitest";
import { proposalStartId, proposalSummary } from "./conversation";
import type { Message, Proposal } from "./domain";

const message = (id: string, role: Message["role"], content: string): Message => ({ id, role, content, at: "2026-11-17T00:00:00.000Z" });

describe("proposal conversation ownership", () => {
  it("starts at the creation request and leaves earlier workspace chat behind", () => {
    const history = [
      message("global-question", "user", "What is my workspace status?"),
      message("global-answer", "assistant", "The workspace is ready."),
      message("start", "user", "Create a project for restaurant reservations"),
      message("clarification", "assistant", "What should it include?"),
      message("details", "user", "Bookings and owner tables"),
    ];
    expect(proposalStartId(history, "Smart Restaurant")).toBe("start");
  });

  it("recognizes an Arabic project request and avoids unrelated older messages", () => {
    expect(proposalStartId([
      message("old", "user", "سؤال عام"),
      message("start", "user", "أنشئ مشروع مطعم للحجوزات"),
      message("answer", "user", "ثلاثة أشهر"),
    ], "مطعم ذكي")).toBe("start");
  });

  it("keeps the edited proposal details available in the new chat", () => {
    const proposal: Proposal = { name: "Restaurant", goal: "Bookings", description: "Responsive reservations", tasks: [{ title: "Build booking flow", priority: "high", checklist: [{ text: "Confirm table", done: false }] }] };
    expect(proposalSummary(proposal, "en")).toContain("Confirm table");
    expect(proposalSummary(proposal, "ar")).toContain("مقترح المشروع المعتمد");
  });
});
