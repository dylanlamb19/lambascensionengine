import { opportunities } from "../review-brief.ts";
import type { Prospect } from "../review-brief.ts";
import { usefulEmail } from "../prospects/reach.ts";
import { decideProspect, isSameCompany, type AutoView } from "./decide.ts";
import { mayFirstTouch, reputationPause } from "./deliverability.ts";
import { industryNudge } from "./learn.ts";
import { priorityScore } from "./priority.ts";
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
    emailBlocked: acted(p, "autonomy_email_blocked"),
    sendFailed: acted(p, "autonomy_send_failed"),
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

  const touchedMeetings: Prospect[] = [];
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const events = await sql<{ prospect_uid: string; google_event_id: string; start_at: string; status: string }>`
      select prospect_uid, google_event_id, start_at::text, status from calendar_events
      where user_id = ${userId} and status = 'booked' and prospect_uid <> ''
    `;
    const { stopSequencesForProspect } = await import("../mail/sql.server.ts");
    for (const event of events) {
      const prospect = prospects.find((p) => p.uid === event.prospect_uid);
      if (!prospect) continue;
      if (prospect.stage === "Won" || prospect.stage === "Lost" || prospect.stage === "Do Not Contact") continue;
      if (prospect.meeting_event_id === event.google_event_id) continue;
      const rescheduled = Boolean(prospect.meeting_event_id);
      prospect.meeting_at = event.start_at;
      prospect.meeting_event_id = event.google_event_id || prospect.meeting_event_id;
      prospect.stage = "Call Booked";
      prospect.stage_plain = "Call is on the calendar";
      prospect.sales_outcome = "";
      prospect.history = [...(prospect.history || []), {
        at: new Date().toISOString(),
        action: rescheduled ? "meeting_rescheduled" : "meeting_booked",
        detail: rescheduled ? "Meeting time changed. Cold outreach stays off." : "Meeting booked. Outreach stopped.",
      }];
      await stopSequencesForProspect(userId, prospect.uid || "");
      touchedMeetings.push(prospect);
    }
  } catch {
    /* calendar rows may be absent — do not stop the tick */
  }

  const dirty: Prospect[] = [...touchedMeetings];
  const today = new Date().toISOString().slice(0, 10);
  let sentToday = prospects.filter((p) => (p.history || []).some((h) => (h.action === "autonomy_sent" || h.action === "email_sent") && (h.at || "").slice(0, 10) === today)).length;
  const bounced = new Set<string>();
  const unsubscribed = new Set<string>();
  const domainsToday = new Set<string>();
  const mailedCompany = new Map<string, string>();
  let lifetimeSent = 0;
  let lifetimeBounced = 0;
  const companyKey = (p: Prospect) => {
    const site = (p.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
    return site || (p.name || "").trim().toLowerCase();
  };
  for (const p of prospects) {
    const sentThis = (p.history || []).some((h) => h.action === "autonomy_sent" || h.action === "email_sent") || p.stage === "Contacted" || p.stage === "Won";
    if (sentThis) {
      const key = companyKey(p);
      if (key && !mailedCompany.has(key)) mailedCompany.set(key, p.uid || p.name);
    }
    for (const h of p.history || []) {
      if (h.action === "autonomy_sent" || h.action === "email_sent") lifetimeSent += 1;
      if (h.action === "bounced" || h.action === "email_bounced") {
        lifetimeBounced += 1;
        const match = (h.detail || "").match(/[^\s]+@[^\s]+/);
        if (match) bounced.add(match[0].toLowerCase());
      }
      if ((h.action === "autonomy_sent" || h.action === "email_sent") && (h.at || "").slice(0, 10) === today) {
        const fromDetail = (h.detail || "").match(/[^\s]+@[^\s]+/);
        const address = fromDetail?.[0] || usefulEmail(p)?.value || "";
        const domain = address.split("@")[1]?.toLowerCase() || "";
        if (domain) domainsToday.add(domain);
      }
    }
    if (p.suppressed || p.stage === "Do Not Contact") {
      const email = usefulEmail(p)?.value;
      if (email) unsubscribed.add(email.toLowerCase());
    }
  }
  try {
    const { deliveryTotals } = await import("../mail/sql.server.ts");
    const totals = await deliveryTotals(userId);
    lifetimeSent = Math.max(lifetimeSent, totals.sent);
    lifetimeBounced = Math.max(lifetimeBounced, totals.bounced);
  } catch {
    /* counts from history still apply */
  }
  const paused = reputationPause(lifetimeSent, lifetimeBounced) || prospects.some((p) => (p.history || []).some((h) => h.action === "autonomy_paused" && (h.at || "").slice(0, 10) === today));
  const ranked = [...prospects].sort((a, b) => {
    const score = (p: Prospect) => priorityScore({
      gaps: opportunities(p).map((o) => o.code),
      reviewCount: p.review_count || 0,
      hasEmail: Boolean(usefulEmail(p)),
      fit: p.fit || "",
      jobValue: p.job_value_est || 0,
      industryNudge: industryNudge(prospects, p.vertical || ""),
    }).score;
    return score(b) - score(a);
  });

  for (const prospect of ranked) {
    try {
    const email = usefulEmail(prospect)?.value || "";
    const screen = email ? mayFirstTouch({
      email,
      bounced,
      unsubscribed,
      domainsMailedToday: domainsToday,
      alreadyMailedCompany: Boolean(mailedCompany.get(companyKey(prospect)) && mailedCompany.get(companyKey(prospect)) !== (prospect.uid || prospect.name)),
    }) : { ok: true as const };
    const decision = decideProspect({
      ...viewOf(prospect),
      emailBlocked: !screen.ok || acted(prospect, "autonomy_email_blocked"),
      reputationPaused: paused,
    }, settings, { testMode: mailSettings.testMode, sentToday });
    if (!screen.ok && !acted(prospect, "autonomy_email_blocked") && decision.action !== "research") {
      dirty.push(stamp(prospect, "autonomy_email_blocked", screen.reason));
      continue;
    }
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
      const { salesBrief } = await import("./sales.ts");
      const { recommendOffer } = await import("../review-brief.ts");
      const offer = recommendOffer(prospect);
      const brief = salesBrief({
        company: prospect.name,
        contact: prospect.contacts?.[0]?.name || email,
        website: prospect.website,
        vertical: prospect.vertical,
        city: prospect.city,
        gaps: opportunities(prospect).map((o) => o.code),
        angle: prospect.outreach?.brief.angle || opportunities(prospect)[0]?.plain || "",
        replySummary: (prospect.history || []).filter((h) => h.action === "reply" || h.action === "autonomy_replied").map((h) => h.detail || "").join(" "),
        emailsSent: acted(prospect, "autonomy_sent") || acted(prospect, "email_sent") ? 1 : 0,
        researchDone: prospect.research_status === "complete" || prospect.research_status === "partial",
        offerName: offer.name,
        offerWhy: offer.why,
      });
      const prepped = stamp(prospect, "call_prep", brief);
      dirty.push(acted(prospect, "meeting_booked") ? prepped : stamp(prepped, "meeting_booked", "Meeting is booked. Outreach is stopped."));
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
          dirty.push(stamp({ ...prospect, stage: "Contacted", stage_plain: "Email sent" }, "autonomy_sent", `First email sent to ${to}.`));
          report.sent += 1;
          sentToday += 1;
        } else {
          dirty.push(stamp(prospect, "autonomy_send_failed", sent.reason || "Send failed. It will not be retried automatically."));
        }
      } catch (err) {
        dirty.push(stamp(prospect, "autonomy_send_failed", err instanceof Error ? err.message : "Send failed."));
      }
    }
    } catch (err) {
      if (!acted(prospect, "autonomy_failed")) {
        dirty.push(stamp(prospect, "autonomy_failed", err instanceof Error ? err.message : "This company failed. The rest of the run continued."));
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
  const { classifyInbound, planReply } = await import("./replies.ts");
  const { replyWantsBooking, publicBookingOrigin, trackedBookingUrl } = await import("./booking-link.ts");
  const classified = classifyInbound(opts.text);
  const closed = opts.prospect.stage === "Call Booked" || opts.prospect.stage === "Won" || opts.prospect.stage === "Lost" || opts.prospect.stage === "Do Not Contact";
  let bookingUrl = "";
  if (!closed && classified.confidence === "high" && replyWantsBooking(classified.cls)) {
    const { accessFor } = await import("../mail/live.server.ts");
    const calendar = await accessFor(opts.userId, "calendar");
    if (!calendar) {
      const { upsertProspects } = await import("../prospects/repo.server.ts");
      await upsertProspects(opts.userId, [stamp(opts.prospect, "calendar_unavailable", "Google Calendar is not connected. No booking link was sent.")]);
      return "escalated";
    }
    const { ensureBookingToken } = await import("../mail/sql.server.ts");
    const email = opts.prospect.contacts?.find((c) => c.email && c.email !== "UNKNOWN")?.email || "";
    const token = await ensureBookingToken(opts.userId, opts.prospect.uid || "", { contact: email, threadId: opts.threadId || "" });
    bookingUrl = trackedBookingUrl(publicBookingOrigin(), token);
  }
  const plan = planReply({
    text: opts.text,
    name: opts.prospect.contacts?.[0]?.name || "there",
    company: opts.prospect.name,
    bookingUrl,
    finding: opts.prospect.outreach?.brief.angle || "",
  });
  const { upsertProspects } = await import("../prospects/repo.server.ts");
  if (plan.dnc) {
    const { stopSequencesForProspect } = await import("../mail/sql.server.ts");
    await stopSequencesForProspect(opts.userId, opts.prospect.uid || "");
    await upsertProspects(opts.userId, [stamp({ ...opts.prospect, suppressed: true, stage: "Do Not Contact" }, "do_not_contact", "They asked to be removed. Outreach is stopped.")]);
    return "stopped";
  }
  if (plan.escalate || !settings.autoReply) {
    await upsertProspects(opts.userId, [stamp({ ...opts.prospect, stage: opts.prospect.stage === "Call Booked" ? opts.prospect.stage : "Replied" }, "autonomy_escalate", `${plan.cls}: needs you. No automatic reply was sent.`)]);
    return "escalated";
  }
  if (plan.cls === "MEETING_BOOKED") {
    await upsertProspects(opts.userId, [stamp({
      ...opts.prospect,
      stage: "Call Booked",
      stage_plain: "Call is on the calendar",
    }, "meeting_booked", "They said the meeting is booked. Outreach stays stopped.")]);
    return "stopped";
  }
  if (closed && replyWantsBooking(plan.cls)) return "skipped";
  if (!plan.send) return "skipped";
  const { loadSettings } = await import("../mail/sql.server.ts");
  const mail = await loadSettings(opts.userId);
  if (mail.testMode) {
    await upsertProspects(opts.userId, [stamp({ ...opts.prospect, booking_url: bookingUrl }, "autonomy_reply_held", bookingUrl ? `Test Mode is on. Nothing was sent. ${bookingUrl}` : "Test Mode is on. Reply was classified and not sent.")]);
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
  await upsertProspects(opts.userId, [stamp({ ...opts.prospect, stage: "Replied", booking_url: bookingUrl }, "autonomy_replied", plan.cls)]);
  return "sent";
}
