const ROLE = /^(noreply|no-reply|donotreply|do-not-reply|postmaster|mailer-daemon|bounce)@/i;
const FAKE = /@(example\.(com|org|net)|localhost|test\.com)$/i;

export function emailLooksUsable(email: string): boolean {
  const e = (email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return false;
  if (ROLE.test(e) || FAKE.test(e)) return false;
  return true;
}

export function domainOf(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

/** Pause only after enough real sends to mean something. Under 20 sends, one bounce is not a crisis. */
export function reputationPause(sent: number, bounced: number): boolean {
  if (sent < 20) return false;
  return bounced / sent >= 0.08;
}

export function mayFirstTouch(opts: {
  email: string;
  bounced: Set<string>;
  unsubscribed: Set<string>;
  domainsMailedToday: Set<string>;
  alreadyMailedCompany: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const email = opts.email.trim().toLowerCase();
  if (!emailLooksUsable(email)) return { ok: false, reason: "That address is not a real inbox. Nothing was sent." };
  if (opts.bounced.has(email)) return { ok: false, reason: "This address bounced before. It will not be tried again." };
  if (opts.unsubscribed.has(email)) return { ok: false, reason: "This address asked to stop. Nothing was sent." };
  if (opts.alreadyMailedCompany) return { ok: false, reason: "This company was already contacted." };
  const domain = domainOf(email);
  if (domain && opts.domainsMailedToday.has(domain)) {
    return { ok: false, reason: "Another company on this domain was already emailed today." };
  }
  return { ok: true };
}
