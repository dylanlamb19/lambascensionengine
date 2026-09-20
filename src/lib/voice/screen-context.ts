import type { CalView } from "../calendar/range.ts";
import { formatTime } from "../calendar/range.ts";
import type { DeskState, DeskWorld } from "./desk-actions.ts";
import { currentTask, currentTaskUid, labeledActionsFor, screenNameOf } from "./screen-actions.ts";
import { visibleOrder } from "./layout.ts";
import { summarizeTheme } from "../visual/theme.ts";
import { findClientsBlockerSpeech, settingsBlockerSpeech } from "./read-screen.ts";
import { integrationSpeech, oauthOnlyGaps } from "../mail/integration-status.ts";

export type ScreenFactKind = "VERIFIED" | "UNKNOWN" | "ESTIMATE" | "ERROR";

export type ScreenFact = { kind: ScreenFactKind; text: string };

export type CurrentScreenContext = {
  route: string;
  screen: string;
  purpose: string;
  selectedUid: string | null;
  selectedName: string | null;
  currentTask: string | null;
  evidenceOpen: boolean;
  testMode: boolean;
  calendarView?: CalView;
  calendarRange?: string;
  calendarStatus?: string;
  selectedEventId?: string | null;
  eventsVisible?: { id: string; title: string; when: string; prospectUid?: string | null; companyName?: string | null }[];
  facts: ScreenFact[];
  lookingAt: string;
  important: string;
  next: string;
  availableActions: string[];
  screenActions: { id: string; label: string; aliases: string[]; risk: string; tool: string }[];
};

export function purposeOf(screen: string): string {
  switch (screen) {
    case "HOME": return "Home — what needs you today.";
    case "TASKS": return "Start My Tasks — one thing at a time.";
    case "PIPELINE": return "Pipeline — companies Lamb Ascension is working through.";
    case "REVIEW": return "Prospect review — decide whether this company is worth your time.";
    case "FIND_CLIENTS": return "Find Clients — search for real companies.";
    case "ADD_CLIENT": return "Add Client — save a company you already know.";
    case "OUTREACH": return "Outreach — the message for this company, still waiting on your approval to send.";
    case "CALL": return "Call opener — what to say, based on verified research.";
    case "PREP": return "Call prep — notes for a sales call.";
    case "CALENDAR": return "Calendar — your real Google Calendar plus Lamb Ascension sales calls.";
    case "SETTINGS": return "Settings — connections, Test Mode, and live-test tools.";
    default: return "Owner Mode.";
  }
}

export function buildScreenContext(state: DeskState, world: DeskWorld, _extras?: { confirmationOpen?: boolean }): CurrentScreenContext {
  const screen = screenNameOf(state);
  const task = currentTask(state, world);
  const uid = currentTaskUid(state, world) || state.openUid;
  const company = world.prospects.find((p) => p.uid === uid);
  const actions = labeledActionsFor(state, world);
  const facts: ScreenFact[] = [];
  const integration = world.integration;
  const gmailKnown = Boolean(integration) || (world.gmail && world.gmail !== "unknown");
  if (integration) {
    facts.push({
      kind: "VERIFIED",
      text: integration.test_mode
        ? "Test Mode is on. Emails only go to the allowlist."
        : "Test Mode is off. Live outreach rules apply. First-contact approval still required.",
    });
  } else if (world.testMode !== false) facts.push({ kind: "VERIFIED", text: "Test Mode is on. Emails only go to the allowlist." });
  else facts.push({ kind: "VERIFIED", text: "Test Mode is off. Live outreach rules apply. First-contact approval still required." });
  if (integration) {
    if (!integration.gmail_connected) facts.push({ kind: "ERROR", text: "Gmail isn’t connected." });
    else if (!integration.gmail_token_valid) facts.push({ kind: "ERROR", text: "Gmail needs attention." });
    // Calendar-not-connected is NOT an ERROR on every screen — it is independent of Gmail.
  } else if (gmailKnown) {
    if (world.gmail === "missing") facts.push({ kind: "ERROR", text: "Gmail isn’t connected." });
    if (world.gmail === "attention") facts.push({ kind: "ERROR", text: "Gmail needs attention." });
  }
  if (!integration && gmailKnown) {
    if (world.calendarStatus === "attention") facts.push({ kind: "ERROR", text: "Google Calendar needs attention." });
  }
  if (world.calendarUnreadable) facts.push({ kind: "ERROR", text: world.calendarReason || "Calendar could not be read." });

  let lookingAt = `You’re looking at ${purposeOf(screen)}`;
  let important = "I only describe what is actually on this screen.";
  let next = "Tell me what you want to do next.";

  if (screen === "HOME") {
    const n = world.tasks.length;
    const first = world.tasks[0];
    lookingAt = "You’re looking at Home.";
    important = n
      ? `The important part is what needs you today. First up: ${first?.title || "a task"}.${first?.plain ? ` ${first.plain}` : ""}`
      : "Nothing is waiting on you right now.";
    next = n
      ? (first?.title?.toLowerCase().includes("contact")
        ? "Find the owner, open the website, or call the listing number. Research failure is not a dead end."
        : "I’d start with the first company on Up Next.")
      : "You can find clients or open Pipeline.";
    if (state.layout) {
      facts.push({ kind: "VERIFIED", text: `Home order: ${visibleOrder(state.layout).join(" → ")}.` });
    }
    if (state.visual) {
      facts.push({ kind: "VERIFIED", text: `Home look: ${summarizeTheme(state.visual)}` });
    }
    if (world.nextCall) {
      facts.push({
        kind: "VERIFIED",
        text: `Upcoming call: ${world.nextCall.companyName || world.nextCall.title} at ${formatTime(world.nextCall.start)}.`,
      });
    }
    const up = first?.uid ? world.prospects.find((p) => p.uid === first.uid) : null;
    if (up) {
      if (up.website) facts.push({ kind: "VERIFIED", text: `Website on file: ${up.website}. Do not invent a different URL.` });
      if (up.phone) facts.push({ kind: "VERIFIED", text: `Listing phone: ${up.phone}. Do not invent a number.` });
      else facts.push({ kind: "UNKNOWN", text: "Decision-maker email is UNKNOWN unless a verified contact is on this card." });
    }
  } else if (screen === "TASKS" && task) {
    lookingAt = `You’re looking at a task: ${task.title}.`;
    important = task.plain || "This is the next thing that needs you.";
    next = "Learn more, find a contact, open the website, or skip. Do not treat research failure as the end.";
    const co = world.prospects.find((p) => p.uid === task.uid);
    if (co?.website) facts.push({ kind: "VERIFIED", text: `Website on file: ${co.website}.` });
    if (co?.phone) facts.push({ kind: "VERIFIED", text: `Listing phone: ${co.phone}.` });
  } else if (screen === "PIPELINE") {
    lookingAt = "You’re looking at your prospect pipeline.";
    const named = world.prospects.slice(0, 6).map((p) => `${p.name}${p.stage_plain ? ` (${p.stage_plain})` : ""}`);
    important = named.length
      ? `These are the companies Lamb Ascension is working through. ${named.join("; ")}.`
      : "There are no companies in the pipeline yet.";
    next = "Open a company to review it, or go find more clients.";
  } else if (screen === "REVIEW" && company) {
    lookingAt = `You’re reviewing ${company.name}.`;
    important = state.evidence
      ? "Evidence is open — these are the public facts we actually collected, not guesses about revenue or budget."
      : company.stage_plain
        ? `We have this company in ${company.stage_plain}. I will not invent revenue or ad spend.`
        : "We have public information on file. I will not invent what we have not verified.";
    next = "Learn more, find a contact, open the website, call the listing number, or draft outreach. Do not invent an email.";
    facts.push({ kind: "VERIFIED", text: `Company: ${company.name} (prospect_uid ${company.uid}).` });
    if (company.stage_plain) facts.push({ kind: "VERIFIED", text: `Stage: ${company.stage_plain}.` });
    if (company.website) facts.push({ kind: "VERIFIED", text: `Website on file: ${company.website}.` });
    if (company.phone) facts.push({ kind: "VERIFIED", text: `Listing phone: ${company.phone}.` });
    facts.push({ kind: "UNKNOWN", text: "Revenue, profit, advertising budget, and any email not listed here are UNKNOWN." });
  } else if (screen === "FIND_CLIENTS") {
    lookingAt = "You’re looking at Find Clients.";
    if (world.discoveryConfigured === false) {
      important = world.findMsg || findClientsBlockerSpeech();
      next = "Add a company you already know, or set up Google Places on the server. I will not invent businesses.";
      facts.push({ kind: "ERROR", text: important });
    } else {
      important = world.findMsg || `Form is set to ${state.findLimit} ${state.vert} in ${state.city}.`;
      next = "Change the search or run Find Clients.";
      if (world.findMsg) facts.push({ kind: "ERROR", text: world.findMsg });
    }
  } else if (screen === "OUTREACH" && company) {
    lookingAt = `You’re looking at outreach for ${company.name}.`;
    important = "The email is a draft. Nothing sends until you approve it.";
    next = "Preview, edit, or say Confirm send if you want it sent.";
  } else if (screen === "CALENDAR") {
    lookingAt = `You’re looking at your calendar (${state.calView} view${world.calendarRange ? `, ${world.calendarRange}` : ""}).`;
    if (world.calendarStatus === "unknown") {
      important = "I’m checking Calendar. I will not say it’s disconnected until the server status loads.";
      next = "Wait a moment, then I can read what’s actually on the calendar.";
    } else if (world.calendarStatus !== "connected") {
      important = "Google Calendar isn’t connected yet, so I cannot show real events.";
      next = "Connect Calendar in Settings. I will not guess what’s on your calendar.";
    } else if (world.calendarUnreadable) {
      important = world.calendarReason || "I couldn’t read Google Calendar.";
      next = "Reconnect Calendar in Settings. I’m not treating this as an empty week.";
    } else {
      const events = world.calEvents || [];
      const sales = events.filter((e) => e.kind === "sales_call");
      important = events.length
        ? `There ${events.length === 1 ? "is 1 event" : `are ${events.length} events`} in this range${sales.length ? `, including ${sales.length} sales call${sales.length === 1 ? "" : "s"}` : ""}.`
        : "No events showed up in this date range. That is a real empty range, not a connection failure.";
      const selected = events.find((e) => e.id === state.calEventId);
      if (selected) {
        important += ` Selected: ${selected.companyName || selected.title} at ${formatTime(selected.start)}.`;
        next = selected.prospectUid ? "I can open the prospect or pull up call prep." : "I can move the calendar or go back.";
      } else {
        next = "I can show today, next week, or open a company from a sales call.";
      }
      for (const ev of events.slice(0, 12)) {
        facts.push({
          kind: "VERIFIED",
          text: `${ev.companyName || ev.title} · ${formatTime(ev.start)} · ${ev.kind === "sales_call" ? "sales call" : "calendar event"}`,
        });
      }
    }
  } else if (screen === "SETTINGS") {
    lookingAt = "You’re in Settings.";
    if (integration) {
      const speech = integrationSpeech(integration, oauthOnlyGaps((world.missingIntegrations || []).filter((m) => !m.ready).map((m) => m.name)));
      important = speech.settingsImportant;
      next = speech.settingsNext;
      for (const fact of speech.facts) {
        if (!facts.some((f) => f.text === fact.text)) facts.push(fact);
      }
    } else if (!gmailKnown) {
      important = "I’m checking your integrations.";
      next = "I’ll have Gmail and Calendar status in a moment.";
    } else {
      const oauthMissing = oauthOnlyGaps((world.missingIntegrations || []).filter((m) => !m.ready).map((m) => m.name));
      if (oauthMissing.length && world.gmail !== "connected") {
        important = settingsBlockerSpeech(oauthMissing);
        next = "Whoever hosts Lamb Ascension needs to add the missing values. Gmail and Calendar can’t connect until that’s done.";
        facts.push({ kind: "ERROR", text: important });
      } else {
        important = [
          world.gmail === "connected" ? "Gmail is connected." : "Gmail isn’t connected.",
          world.calendarStatus === "connected" ? "Google Calendar is connected." : "Google Calendar still needs to be connected.",
        ].join(" ");
        next = world.calendarStatus === "connected"
          ? "Gmail and Calendar are ready."
          : "Connect Google Calendar when you’re ready. Gmail can already send if it is connected.";
        if (world.gmail !== "connected") facts.push({ kind: "ERROR", text: "Gmail isn’t connected." });
        if (world.calendarStatus !== "connected") facts.push({ kind: "UNKNOWN", text: "Google Calendar isn’t connected yet." });
      }
    }
  } else if (screen === "CALL" || screen === "PREP") {
    lookingAt = `You’re looking at ${screen === "PREP" ? "call prep" : "the call opener"}${company ? ` for ${company.name}` : ""}.`;
    important = "This is based on verified research. Unknowns stay unknown.";
    next = "Open the prospect, or go back.";
  }

  return {
    route: state.view,
    screen,
    purpose: purposeOf(screen),
    selectedUid: uid,
    selectedName: company?.name || task?.title || null,
    currentTask: task?.title || null,
    evidenceOpen: state.evidence,
    testMode: world.testMode !== false,
    calendarView: state.calView,
    calendarRange: world.calendarRange,
    calendarStatus: world.calendarStatus,
    selectedEventId: state.calEventId,
    eventsVisible: (world.calEvents || []).map((e) => ({
      id: e.id,
      title: e.title,
      when: formatTime(e.start),
      prospectUid: e.prospectUid,
      companyName: e.companyName,
    })),
    facts,
    lookingAt,
    important,
    next,
    availableActions: actions.map((a) => a.tool),
    screenActions: actions.map((a) => ({ id: a.id, label: a.label, aliases: a.aliases, risk: a.risk, tool: a.tool })),
  };
}

export function explainScreen(ctx: CurrentScreenContext): string {
  return [ctx.lookingAt, `The important part is: ${ctx.important}`, `I’d focus on: ${ctx.next}`].join(" ");
}
