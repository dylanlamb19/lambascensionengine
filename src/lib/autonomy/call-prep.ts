export function callPrep(opts: {
  company: string;
  contact: string;
  when: string;
  vertical: string;
  city: string;
  finding: string;
  emailsSent: number;
  replySummary: string;
  bookingUrl: string;
}): string {
  const finding = opts.finding.trim() || "No single verified website gap was stored. Do not invent one on the call.";
  return [
    `${opts.company}`,
    opts.contact ? `With ${opts.contact}` : "Contact not named on file",
    opts.when ? `When: ${opts.when}` : "",
    "",
    `What they do: ${opts.vertical || "Unknown category"}${opts.city ? ` in ${opts.city}` : ""}.`,
    `Why they were targeted: ${finding}`,
    `Emails sent: ${opts.emailsSent}.`,
    opts.replySummary ? `What they said: ${opts.replySummary}` : "No reply text stored.",
    "",
    "Ask: How are you getting customers today, and what happens after someone visits the site?",
    "Do not claim their revenue, ad spend, or that they already want to buy.",
    opts.bookingUrl ? `Booking link on file: ${opts.bookingUrl}` : "",
    "Best next step: agree on one acquisition gap and whether a short engagement is worth a proposal.",
  ].filter((line) => line !== "").join("\n");
}
