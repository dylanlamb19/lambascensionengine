export type OwnerTaskState =
  | "OPEN"
  | "IN_PROGRESS"
  | "APPROVED_WAITING_FOR_LIVE"
  | "COMPLETED"
  | "SKIPPED"
  | "SNOOZED"
  | "NOT_PURSUING"
  | "FAILED";

const RESOLVED = new Set(["APPROVED_WAITING_FOR_LIVE", "COMPLETED", "NOT_PURSUING"]);

export function isUnresolvedTask(state: OwnerTaskState): boolean {
  return !RESOLVED.has(state);
}

export function ownerTaskStateFromHistory(history: { action: string }[] | undefined): OwnerTaskState {
  const last = [...(history || [])].reverse().find((row) => row.action.startsWith("owner_task_"));
  if (last?.action === "owner_task_approved_waiting") return "APPROVED_WAITING_FOR_LIVE";
  if (last?.action === "owner_task_completed") return "COMPLETED";
  if (last?.action === "owner_task_not_pursuing") return "NOT_PURSUING";
  if (last?.action === "owner_task_failed") return "FAILED";
  return "OPEN";
}

export function taskKind(task: { action: string; title: string }): "contact" | "reply" | "call" | "research" | "contact_info" | "info" {
  if (task.action === "outreach") return "contact";
  if (task.action === "prep") return "call";
  if (/replied/i.test(task.title)) return "reply";
  if (task.action === "find_contact") return "contact_info";
  if (/look up/i.test(task.title)) return "research";
  return "info";
}

export function primaryTaskCta(kind: ReturnType<typeof taskKind>, testMode: boolean): { id: string; label: string } {
  if (kind === "contact") return { id: "review_outreach", label: "Review Outreach" };
  if (kind === "reply") return { id: "review_reply", label: "Review Reply" };
  if (kind === "call") return { id: "view_brief", label: "View Call Brief" };
  if (kind === "research") return { id: "run_research", label: "Run Research" };
  if (kind === "contact_info") return { id: "find_contact", label: "Find Contact" };
  return { id: "learn_more", label: testMode ? "Learn More" : "Learn More" };
}

export function approveLabel(testMode: boolean): string {
  return testMode ? "Approve for Live" : "Approve & Send";
}

export function freezeDraft(input: { recipient: string; subject: string; body: string; at: string }) {
  return {
    state: "APPROVED_WAITING_FOR_LIVE" as const,
    sent: false as const,
    frozen: { recipient: input.recipient, subject: input.subject, body: input.body, approvedAt: input.at },
  };
}

export function nextIndexAfterRemoval(index: number, lengthAfter: number): number | null {
  if (lengthAfter <= 0) return null;
  return Math.min(index, lengthAfter - 1);
}

export function voiceTaskIntent(text: string): "approve" | "skip" | "not_pursuing" | "next" | null {
  const q = (text || "").toLowerCase().replace(/[?.!]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(not interested|not pursuing|stop pursuing)\b/.test(q)) return "not_pursuing";
  if (/\b(skip this|skip it|skip this one)\b/.test(q)) return "skip";
  if (/\b(next one|next task|show me the next)\b/.test(q)) return "next";
  if (/\b(approve it|approve this|approve for live|send this one)\b/.test(q)) return "approve";
  return null;
}
