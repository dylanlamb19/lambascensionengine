/**
 * Drafts the message a Lead Follow-Up step would send.
 * The text is stored on the step log. This module has no sender, no text
 * provider, and no sales outreach worker.
 */

export type DryRunDraft = {
  to: string;
  subject: string;
  body: string;
  logLine: string;
};

export type DraftInput = {
  stepId: "speed-to-lead" | "day-1" | "day-3" | "day-7";
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  clientName: string;
};

const SUBJECTS: Record<DraftInput["stepId"], string> = {
  "speed-to-lead": "We got your note",
  "day-1": "Checking in",
  "day-3": "Still here if you need us",
  "day-7": "Last note on your inquiry",
};

function bodyFor(input: DraftInput): string {
  const name = input.contactName.trim() || "there";
  const client = input.clientName.trim() || "the team";
  if (input.stepId === "speed-to-lead") {
    return `Hi ${name}, this is ${client}. We received your inquiry and a person on the team will follow up.`;
  }
  if (input.stepId === "day-1") {
    return `Hi ${name}, checking in on your note to ${client}. Reply if you still want to talk.`;
  }
  if (input.stepId === "day-3") {
    return `Hi ${name}, a quick follow-up from ${client}. We can pick this up whenever you are ready.`;
  }
  return `Hi ${name}, last note from ${client} about your inquiry. A person can take it from here if you reply.`;
}

/** Record the intended message. The return value is a log line, not a delivery. */
export function draftFollowUp(input: DraftInput): DryRunDraft {
  const email = input.contactEmail.trim();
  const phone = input.contactPhone.trim();
  const to = email || phone || input.contactName.trim() || "unknown contact";
  const channel = email ? "Not sent by email." : phone ? "Not sent by text." : "Not sent.";
  const subject = SUBJECTS[input.stepId];
  const body = bodyFor(input);
  const logLine = `Dry run. Intended message was not sent. To ${to}. Subject: ${subject}. ${body} ${channel} Nothing was sent. Sales outreach was not used.`;
  return { to, subject, body, logLine };
}
