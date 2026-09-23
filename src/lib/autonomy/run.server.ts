import { opportunities } from "../review-brief.ts";
import type { Prospect } from "../review-brief.ts";
import { usefulEmail } from "../prospects/reach.ts";
import { decideProspect, isSameCompany, type AutoView } from "./decide.ts";
import { callPrep } from "./call-prep.ts";
import { planReply } from "./replies.ts";
import { nextMarket, normalizeAutonomy, type AutonomySettings } from "./settings.ts";

function acted(p: Prospect, action: string): boolean {
  return (p.history || []).some((h) => h.action === action);
}

function viewOf(p: Prospect): AutoView {
  const email = usefulEmail(p);
  const opps = opportunities(p);
  return {
    name: p.name,
    stage: p.stage || "",
    suppressed: Boolean(p.suppressed),
    researchStatus: p.research_status || "none",
    hasWebsite: Boolean(p.website && p.website !== "UNKNOWN"),
    hasEmail: Boolean(email),
    hasOpportunity: opps.length > 0,
    fit: p.fit || "",
    hasPack: Boolean(p.outreach?.messages?.some((m) => m.kind === "email" && m.body)),
    alreadySent: acted(p, "email_sent") || acted(p, "autonomy_sent") || p.stage === "Contacted",
    booked: p.stage === "Call Booked",
    prepDone: acted(p, "call_prep"),
    disqualified: acted(p, "autonomy_disqualified"),
  };
}

async function loadAutonomy(userId: string): Promise<AutonomySettings> {
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{ autonomy: unknown }>`select autonomy from outreach_settings where user_id = ${userId}`;
    return normalizeAutonomy(rows[0]?.autonomy);
  } catch {
    return normalizeAutonomy(null);
  }
}

export async function saveAutonomy(userId: string, patch: Partial<AutonomySettings>): Promise<AutonomySettings> {
  const current = await loadAutonomy(userId);
  const next = normalizeAutonomy({ ...current, ...patch });
  const { getSql } = await import("../db.ts");
  const sql = await getSql();
  await sql`
    insert into outreach_settings (user_id, autonomy)
    values (${userId}, ${JSON.stringify(next)}::jsonb)
    on conflict (user_id) do update set autonomy = excluded.autonomy
  `;
  return next;
}

export async function readAutonomy(userId: string): Promise<AutonomySettings> {
  return loadAutonomy(userId);
}

function stamp(p: Prospect, action: string, detail: string): Prospect {
  return {
    ...p,
    history: [...(p.history || []), { at: new Date().toISOString(), action, detail }],
  };
}

export async function runAutonomyPass(userId: string): Promise<{ researched: number; generated: number; held: number; sent: number; prepped: number }> {
  const report = { researched: 0, generated: 0, held: 0, sent: 0, prepped: 0 };
  const settings = await loadAutonomy(userId);
  if (!settings.autonomous) return report;
  const { listProspects, upsertProspects, importProspects, logActivity } = await import("../prospects/repo.server.ts");
  const { loadSettings } = await import("../mail/sql.server.ts");
  const mailSettings = await loadSettings(userId);
  let prospects = await listProspects(userId);
  const foundToday = prospects.filter((p) => (p.discovered_at || "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length;

  if (settings.prospecting && foundToday < settings.dailyProspectLimit) {
    try {
      const { env } = await import("../env.server.ts");
      const key = env("GOOGLE_PLACES_API_KEY");
      if (key) {
        const tick = Math.floor(Date.now() / 3_600_000);
        const market = nextMarket(settings, tick);
        const { searchText } = await import("../discovery/places.ts");
        const { hitToProspect } = await import("../discovery/to-prospect.ts");
        const { tryReserveDiscovery, EST_SEARCH_CENTS } = await import("../discovery/usage.server.ts");
        const found = await searchText({
          apiKey: key,
          vertical: market.vertical,
          location: market.city,
          radiusM: 20000,
          limit: 5,
          minRating: 0,
          reserve: async () => tryReserveDiscovery(userId, EST_SEARCH_CENTS),
        });
        if (!("error" in found)) {
          const fresh = found.places
            .map((hit, i) => hitToProspect(hit, prospects.length + i + 1))
            .filter((candidate) => !prospects.some((existing) => isSameCompany(existing, candidate)));
          if (fresh.length) {
            const imported = await importProspects(userId, fresh.slice(0, 5));
            prospects = imported.prospects;
            await logActivity(userId, "autonomy_find", `Found ${fresh.length} in ${market.vertical} / ${market.city}`, undefined, "AUTOMATION");
          }
        }
      }
    } catch {
      /* discovery must not fail the tick */
    }
  }

  const dirty: Prospect[] = [];
  let sentToday = prospects.filter((p) => acted(p, "autonomy_sent") && (p.history || []).some((h) => h.action === "autonomy_sent" && (h.at || "").slice(0, 10) === new Date().toISOString().slice(0, 10))).length;

  for (const prospect of prospects) {
    const decision = decideProspect(viewOf(prospect), settings, { testMode: mailSettings.testMode, sentToday });
    if (decision.action === "research" && report.researched < 1 && !acted(prospect, "autonomy_research_queued")) {
      try {
        const { runDeepResearch } = await import("../research/orchestrate.ts");
        const result = await runDeepResearch({
          name: prospect.name,
          website: prospect.website,
          vertical: prospect.vertical,
          city: prospect.city,
          phone: prospect.phone,
          google_rating: prospect.google_rating,
          review_count: prospect.review_count,
          score: prospect.score,
          research_status: "running",
        }, { minScoreForEnrichment: 65, dailyEnrichmentUsed: 0, dailyEnrichmentCap: 1 });
        dirty.push(stamp({
          ...prospect,
          research_status: "complete",
          findings: result.findings || prospect.findings,
          facts: result.facts,
          contacts: result.contacts?.length ? result.contacts : prospect.contacts,
          ads: result.ads,
          readiness: result.readiness,
          readiness_why: result.readiness_why,
          company_kind: result.company_kind,
          website_note: result.website_note,
        }, "research_completed", "Researched automatically from the public website. Unknown stayed unknown."));
        report.researched += 1;
      } catch {
        dirty.push(stamp(prospect, "autonomy_research_queued", "Research did not finish this pass. Nothing was invented."));
      }
      continue;
    }
    if (decision.action === "disqualify" && !acted(prospect, "autonomy_disqualified")) {
      dirty.push(stamp(prospect, "autonomy_disqualified", decision.reason));
      continue;
    }
    if (decision.action === "generate") {
      const { generateOutreach } = await import("../outreach/generate.ts");
      const pack = generateOutreach(prospect);
      if (settings.bookingUrl) {
        for (const message of pack.messages) {
          if (message.kind === "followup2" || message.kind === "followup3") {
            if (!message.body.includes(settings.bookingUrl)) {
              message.body += `\n\nIf you'd rather just talk, grab a time here:\n${settings.bookingUrl}`;
            }
          }
        }
      }
      dirty.push(stamp({
        ...prospect,
        stage: "Approved for Outreach",
        stage_plain: "Ready to send",
        outreach: pack,
      }, "outreach_generated", decision.reason));
      report.generated += 1;
      continue;
    }
    if (decision.action === "hold" && !acted(prospect, "autonomy_held")) {
      dirty.push(stamp(prospect, "autonomy_held", decision.reason));
      report.held += 1;
      continue;
    }
    if (decision.action === "prep" && !acted(prospect, "call_prep")) {
      const email = usefulEmail(prospect);
      const brief = callPrep({
        company: prospect.name,
        contact: prospect.contacts?.[0]?.name || email?.value || "",
        when: "",
        vertical: prospect.vertical,
        city: prospect.city,
        finding: prospect.outreach?.brief.angle || opportunities(prospect)[0]?.plain || "",
        emailsSent: acted(prospect, "autonomy_sent") || acted(prospect, "email_sent") ? 1 : 0,
        replySummary: "",
        bookingUrl: settings.bookingUrl,
      });
      dirty.push(stamp(prospect, "call_prep", brief));
      report.prepped += 1;
      continue;
    }
    if (decision.action === "send" && report.sent < 1 && settings.autoSend && !mailSettings.testMode) {
      const to = usefulEmail(prospect)?.value || "";
      const email = prospect.outreach?.messages.find((m) => m.kind === "email");
      if (!to || !email) continue;
      try {
        const { sendLive } = await import("../mail/live.server.ts");
        const sent = await sendLive({
          userId,
          prospect,
          kind: "email",
          method: "AUTOMATION",
          to,
          subject: email.subject || `${prospect.name} — quick opportunity I noticed`,
          body: email.body,
          firstApproved: true,
        });
        if (sent.ok) {
          const { saveSequence } = await import("../mail/sql.server.ts");
          const now = Date.now();
          const uid = prospect.uid || "";
          if (settings.autoFollowup && uid) {
            await saveSequence(userId, uid, "AUTOMATION", [
              { step: "followup1", dueAt: now + 3 * 86400000, idempotencyKey: `${userId}:${uid}:followup1`, body: prospect.outreach?.messages.find((m) => m.kind === "followup1")?.body || "", subject: email.subject || prospect.name, recipient: to, threadId: sent.threadId },
              { step: "followup2", dueAt: now + 7 * 86400000, idempotencyKey: `${userId}:${uid}:followup2`, body: prospect.outreach?.messages.find((m) => m.kind === "followup2")?.body || "", subject: email.subject || prospect.name, recipient: to, threadId: sent.threadId },
              { step: "followup3", dueAt: now + 12 * 86400000, idempotencyKey: `${userId}:${uid}:followup3`, body: prospect.outreach?.messages.find((m) => m.kind === "followup3")?.body || "", subject: email.subject || prospect.name, recipient: to, threadId: sent.threadId },
            ]);
          }
          dirty.push(stamp({ ...prospect, stage: "Contacted", stage_plain: "Email sent" }, "autonomy_sent", "First email sent by the acquisition engine."));
          report.sent += 1;
          sentToday += 1;
        }
      } catch {
        /* send failure must not kill the tick */
      }
    }
  }

  if (dirty.length) await upsertProspects(userId, dirty);
  return report;
}

export async function autoReplyTo(opts: {
  userId: string;
  prospect: Prospect;
  text: string;
  threadId?: string | null;
}): Promise<"sent" | "held" | "escalated" | "stopped" | "skipped"> {
  const settings = await loadAutonomy(opts.userId);
  const plan = planReply({
    text: opts.text,
    name: opts.prospect.contacts?.[0]?.name || "there",
    company: opts.prospect.name,
    bookingUrl: settings.bookingUrl,
    finding: opts.prospect.outreach?.brief.angle || "",
  });
  const { upsertProspects } = await import("../prospects/repo.server.ts");
  if (plan.dnc) {
    await upsertProspects(opts.userId, [stamp({ ...opts.prospect, suppressed: true, stage: "Do Not Contact" }, "do_not_contact", "They asked to be removed. Outreach is stopped.")]);
    return "stopped";
  }
  if (plan.escalate || !settings.autoReply) {
    await upsertProspects(opts.userId, [stamp({ ...opts.prospect, stage: opts.prospect.stage === "Call Booked" ? opts.prospect.stage : "Replied" }, "autonomy_escalate", `${plan.cls}: needs you. No automatic reply was sent.`)]);
    return "escalated";
  }
  if (!plan.send) return "skipped";
  const { loadSettings } = await import("../mail/sql.server.ts");
  const mail = await loadSettings(opts.userId);
  if (mail.testMode) {
    await upsertProspects(opts.userId, [stamp(opts.prospect, "autonomy_reply_held", "Test Mode is on. Reply was classified and not sent.")]);
    return "held";
  }
  const to = usefulEmail(opts.prospect)?.value || "";
  if (!to) return "escalated";
  const { sendLive } = await import("../mail/live.server.ts");
  const sent = await sendLive({
    userId: opts.userId,
    prospect: opts.prospect,
    kind: "reply",
    method: "AUTOMATION",
    to,
    subject: `Re: ${opts.prospect.name}`,
    body: plan.body,
    firstApproved: true,
    threadId: opts.threadId,
  });
  if (!sent.ok) return "held";
  await upsertProspects(opts.userId, [stamp({ ...opts.prospect, stage: "Replied" }, "autonomy_replied", plan.cls)]);
  return "sent";
}
