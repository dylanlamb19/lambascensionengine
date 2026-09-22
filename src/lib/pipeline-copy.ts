export const FIT: Record<string, string> = {
  priority: "Strong fit — worth your time",
  strong: "Good fit",
  possible: "Possible, not a sure thing",
  low: "Weak fit — easy skip",
};

export const STAGE: Record<string, string> = {
  New: "Just added",
  Researching: "We're looking them up",
  Qualified: "Research done — your move",
  "Ready for Review": "Waiting for you to review",
  "Approved for Outreach": "Ready for you to send a note",
  Contacted: "You already reached out",
  Replied: "They wrote back",
  "Call Booked": "Call is on the calendar",
  "Proposal Sent": "Proposal is out",
  Negotiation: "You're working the deal",
  Won: "Signed client",
  Lost: "Not moving forward",
  "Do Not Contact": "Skipped — do not contact",
};

/** Plain next-step copy by reach state — no invented emails, ROAS, or pricing. */
export const NEXT_MOVE: Record<string, string> = {
  READY_TO_CONTACT: "Draft a note — nothing sends until you confirm.",
  NEEDS_CONTACT_INFO: "Find a real contact before you pitch.",
  NEEDS_RESEARCH: "Look them up before you spend time on outreach.",
  BLOCKED: "Leave them alone — Do Not Contact.",
  SUPPRESSED: "Suppressed — do not restart outreach.",
};
