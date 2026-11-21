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

export type ReviewDraftInput = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  clientName: string;
  jobLabel: string;
};

export type AppointmentDraftKind = "confirm" | "reminder-24h" | "reminder-2h" | "reschedule" | "no-show";

export type AppointmentDraftInput = {
  kind: AppointmentDraftKind;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  clientName: string;
  whenLabel: string;
};

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

const REVIEW_EQUAL = "Reviews are not purchased, gated, or filtered. Every completed-job customer is asked the same way.";

/**
 * The same request for every completed job. No rating, no gate, and no send.
 */
export function draftReviewRequest(input: ReviewDraftInput): DryRunDraft {
  const name = input.customerName.trim() || "there";
  const client = input.clientName.trim() || "the team";
  const job = input.jobLabel.trim() || "the completed job";
  const email = input.customerEmail.trim();
  const phone = input.customerPhone.trim();
  const to = email || phone || name;
  const channel = email ? "Not sent by email." : phone ? "Not sent by text." : "Not sent.";
  const subject = "How did the job go?";
  const body = `Hi ${name}, this is ${client}. Your job (${job}) is complete. If you have a minute, a public review helps other customers. Say whatever you think. We ask every customer the same way.`;
  const logLine = `Dry run. Intended review request was not sent. To ${to}. Subject: ${subject}. ${body} ${channel} Nothing was sent. ${REVIEW_EQUAL} Sales outreach was not used.`;
  return { to, subject, body, logLine };
}

export type EstimateDraftKind = "day-2" | "day-5" | "day-10" | "close-out";

export type EstimateDraftInput = {
  kind: EstimateDraftKind;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  clientName: string;
  label: string;
};

const ESTIMATE_SUBJECTS: Record<EstimateDraftKind, string> = {
  "day-2": "Your estimate is still open",
  "day-5": "Checking on your estimate",
  "day-10": "Your estimate is still here",
  "close-out": "Closing the loop on your estimate",
};

/** A follow-up for an open estimate. Nothing is sent, and Lead Follow-Up is not copied. */
export function draftEstimateFollowUp(input: EstimateDraftInput): DryRunDraft {
  const name = input.customerName.trim() || "there";
  const client = input.clientName.trim() || "the team";
  const label = input.label.trim() || "your estimate";
  const email = input.customerEmail.trim();
  const phone = input.customerPhone.trim();
  const to = email || phone || name;
  const channel = email ? "Not sent by email." : phone ? "Not sent by text." : "Not sent.";
  const subject = ESTIMATE_SUBJECTS[input.kind];
  const body = input.kind === "close-out"
    ? `Hi ${name}, this is ${client}. This is the last note on the open estimate for ${label}. A person can close it if you reply.`
    : `Hi ${name}, this is ${client}. The estimate for ${label} is still open. Reply if you want to move ahead or if you have a question.`;
  const logLine = `Dry run. Intended estimate follow-up was not sent. To ${to}. Subject: ${subject}. ${body} ${channel} Nothing was sent. Lead Follow-Up was not duplicated. Sales outreach was not used.`;
  return { to, subject, body, logLine };
}

const APPOINTMENT_SUBJECTS: Record<AppointmentDraftKind, string> = {
  confirm: "Your appointment is booked",
  "reminder-24h": "Appointment tomorrow",
  "reminder-2h": "Appointment soon",
  reschedule: "Your appointment time changed",
  "no-show": "We missed you",
};

/** A confirmation, reminder, reschedule note, or no-show note. Nothing is sent. */
export function draftAppointmentMessage(input: AppointmentDraftInput): DryRunDraft {
  const name = input.customerName.trim() || "there";
  const client = input.clientName.trim() || "the team";
  const when = input.whenLabel.trim() || "the booked time";
  const email = input.customerEmail.trim();
  const phone = input.customerPhone.trim();
  const to = email || phone || name;
  const channel = email ? "Not sent by email." : phone ? "Not sent by text." : "Not sent.";
  const subject = APPOINTMENT_SUBJECTS[input.kind];
  const body = input.kind === "no-show"
    ? `Hi ${name}, this is ${client}. We missed you at ${when}. Reply if you want another time.`
    : input.kind === "reschedule"
      ? `Hi ${name}, this is ${client}. The booking is now ${when}. Reply if that time does not work.`
      : `Hi ${name}, this is ${client}. You are booked for ${when}. Reply to confirm or to ask for a new time.`;
  const logLine = `Dry run. Intended ${subject.toLowerCase()} was not sent. To ${to}. Subject: ${subject}. ${body} ${channel} Nothing was sent. The owner sales calendar was not read. Sales outreach was not used.`;
  return { to, subject, body, logLine };
}
