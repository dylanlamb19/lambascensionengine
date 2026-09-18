import type { GmailPort, GmailSendInput, GmailSendResult } from "../mail/types.ts";

function rfc822(input: GmailSendInput): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}

export function liveGmail(accessToken: string, fetchImpl: typeof fetch = fetch): GmailPort {
  return {
    async send(input: GmailSendInput): Promise<GmailSendResult> {
      const raw = Buffer.from(rfc822(input)).toString("base64url");
      const body: Record<string, unknown> = { raw };
      if (input.threadId) body.threadId = input.threadId;
      let res: Response;
      try {
        res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch {
        return { ok: false, error: "timeout", timeout: true };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, error: "disconnected", disconnected: true };
      const json = (await res.json()) as { id?: string; threadId?: string; error?: { message?: string } };
      if (!res.ok || !json.id) {
        const msg = json.error?.message || `Gmail HTTP ${res.status}`;
        const bounced = /bounce|invalid recipient|failed recipient/i.test(msg);
        return { ok: false, error: msg, bounced };
      }
      return { ok: true, messageId: json.id, threadId: json.threadId || json.id };
    },
    async listNewReplies(threadId: string) {
      const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        messages?: {
          id?: string;
          labelIds?: string[];
          payload?: { headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: { body?: { data?: string } }[] };
        }[];
      };
      const out: { id: string; from: string; body: string; labelIds?: string[] }[] = [];
      for (const m of json.messages || []) {
        const headers = m.payload?.headers || [];
        const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "";
        const b64 = m.payload?.body?.data || m.payload?.parts?.[0]?.body?.data || "";
        let body = "";
        try {
          body = Buffer.from(b64, "base64url").toString("utf8");
        } catch {
          body = "";
        }
        if (m.id) out.push({ id: m.id, from, body, labelIds: m.labelIds });
      }
      return out;
    },
  };
}

export async function gmailProfile(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  try {
    const res = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Gmail needs to be reconnected." };
    }
    if (!res.ok) return { ok: false, reason: "Could not read the Gmail account." };
    const json = (await res.json()) as { emailAddress?: string };
    if (!json.emailAddress) return { ok: false, reason: "Gmail did not return an account email." };
    return { ok: true, email: json.emailAddress };
  } catch {
    return { ok: false, reason: "Could not reach Gmail." };
  }
}
