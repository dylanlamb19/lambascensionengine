import type { IntentName, ParsedIntent, Risk, VoiceContext } from "./types.ts";
import { HIGH_INTENTS, MEDIUM_INTENTS } from "./types.ts";
import { parseSpokenHour } from "../calendar/range.ts";
import { isPersonalCalendarCommand, isOwnerCalendarManageCommand } from "../calendar/owner-event.ts";
import { parseSpokenFilter } from "../prospects/view-filter.ts";

function riskOf(intent: IntentName): Risk {
  if (HIGH_INTENTS.includes(intent)) return "HIGH";
  if (MEDIUM_INTENTS.includes(intent)) return "MEDIUM";
  return "LOW";
}

function hit(t: string, re: RegExp): boolean {
  return re.test(t);
}

/** Drop the wake word so “Ara, open Pipeline” parses like “open Pipeline”. */
export function stripWake(raw: string): string {
  return (raw || "").replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "").trim();
}

export type StopKind = "none" | "stop_speech" | "stop_task" | "stop_conversation";
export type StopIntentSource = "none" | "finalized_owner_transcript" | "explicit_barge_in_phrase" | "ui_button";

export type OwnerStopIntent = {
  detected: boolean;
  kind: StopKind;
  source: StopIntentSource;
  phrase: string;
  confidence: "none" | "low" | "high";
  turnId: string | null;
  reason: string;
  normalized: string;
  raw: string;
};

export function normalizeOwnerTranscript(raw: string): string {
  return stripWake(raw || "")
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_NEGATED = /\b(don'?t|do not|never|not)\b.{0,24}\bstop\b/;
const STOP_OTHER_SENSE = /\bstop[- ]loss\b|\bstop by\b|\bstop[- ]sign\b|\bnon[- ]stop\b|\bstopwatch\b/;
const STOP_ECHO = /^(ok|okay|alright|all right|sure)?\s*stopped$/;
const CONVERSATION_STOP = new Set([
  "stop listening",
  "stop conversation",
  "stop conversation mode",
  "end conversation",
  "end conversation mode",
  "turn off voice",
  "turn off the voice",
  "voice off",
  "mute",
  "mute ara",
  "stop ara",
  "disable conversation",
  "hang up",
  "stop talking to me",
]);
const SPEECH_STOP = new Set([
  "stop talking",
  "be quiet",
  "quiet",
  "hush",
  "hold on",
  "hold on a second",
  "hold on a minute",
  "let me talk",
  "let me speak",
  "let me finish",
  "enough",
  "pause",
  "wait",
  "wait a second",
  "wait a minute",
]);
const TASK_STOP = new Set([
  "cancel",
  "cancel that",
  "cancel that research",
  "cancel that email",
  "never mind",
  "nevermind",
  "forget it",
  "forget that",
]);
const BARE_STOP = new Set(["stop", "ara stop"]);
const BARGE_PHRASES = new Set(["stop", "stop talking", "be quiet", "hold on", "wait", "ara stop", "quiet"]);

function stopResult(
  raw: string,
  normalized: string,
  kind: StopKind,
  source: StopIntentSource,
  reason: string,
  turnId: string | null,
): OwnerStopIntent {
  return {
    detected: kind !== "none",
    kind,
    source: kind === "none" ? "none" : source,
    phrase: kind === "none" ? "" : normalized,
    confidence: kind === "none" ? "none" : "high",
    turnId,
    reason,
    normalized,
    raw,
  };
}

/**
 * Intent-aware owner stop detector. Never uses includes("stop") or prefix matching.
 * Interim transcripts cannot execute conversation teardown.
 */
export function classifyOwnerStopIntent(
  raw: string,
  opts: {
    finalized?: boolean;
    araSpeaking?: boolean;
    source?: StopIntentSource;
    turnId?: string | null;
  } = {},
): OwnerStopIntent {
  const finalized = opts.finalized !== false;
  const source: StopIntentSource = opts.source || (finalized ? "finalized_owner_transcript" : "explicit_barge_in_phrase");
  const turnId = opts.turnId ?? null;
  const normalized = normalizeOwnerTranscript(raw);
  const none = (reason: string) => stopResult(raw, normalized, "none", "none", reason, turnId);

  if (!normalized) return none("empty");
  if (!finalized) {
    const words = normalized.split(" ").filter(Boolean);
    if (!opts.araSpeaking) return none("interim_ignored");
    if (words.length > 4 || !BARGE_PHRASES.has(normalized)) return none("interim_not_explicit_stop");
  }
  if (STOP_NEGATED.test(normalized)) return none("negated_stop");
  if (STOP_OTHER_SENSE.test(normalized)) return none("stop_used_as_other_sense");
  if (STOP_ECHO.test(normalized)) return none("echo_stopped");

  if (CONVERSATION_STOP.has(normalized)) {
    return stopResult(raw, normalized, "stop_conversation", source, "explicit_conversation_stop", turnId);
  }
  if (SPEECH_STOP.has(normalized)) {
    return stopResult(raw, normalized, "stop_speech", source, "explicit_speech_stop", turnId);
  }
  if (TASK_STOP.has(normalized)) {
    return stopResult(raw, normalized, "stop_task", source, "explicit_task_cancel", turnId);
  }
  if (BARE_STOP.has(normalized)) {
    if (opts.araSpeaking) {
      return stopResult(raw, normalized, "stop_speech", source, "bare_stop_while_speaking", turnId);
    }
    return none("bare_stop_while_listening_is_not_conversation_mode");
  }
  if (/\bstop\b/.test(normalized) || /\bcancel\b/.test(normalized) || /\bwait\b/.test(normalized)) {
    return none("stop_word_not_command");
  }
  return none("no_stop_intent");
}

/** Ara TTS that is a false stop-ack. Must never become an owner command or a caption while Conversation Mode is on. */
export function isHallucinatedStopAck(raw: string): boolean {
  const t = normalizeOwnerTranscript(raw);
  if (!t) return false;
  if (STOP_ECHO.test(t)) return true;
  return (
    /^(ok|okay|alright|all right|sure)?\s*(i('m| am) )?(now )?(have |'ve |just )?(just )?stopped( talking| listening)?$/.test(t)
    || /^(ok|okay)\s+i\s+stopped( talking| listening)?$/.test(t)
    || /^i('ve| have) stopped( talking| listening)?$/.test(t)
    || /^(stopping now|i will stop|i'll stop|i stopped)$/.test(t)
  );
}

/** Tools the model must not own. Stop/disconnect is client-side only. */
export function isClientOwnedStopTool(name: string): boolean {
  const n = (name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (
    n === "computer_stop"
    || n === "stop"
    || n === "stop_ara"
    || n === "stop_listening"
    || n === "stop_conversation"
    || n === "end_conversation"
    || n === "hang_up"
    || n === "disconnect"
    || n === "abort"
  );
}

const THIS_RE = /^(this|them|it|this one|that one|this company|that company|them)$/;

export function parseSpokenCommand(raw: string): ParsedIntent {
  const stripped = stripWake(raw);
  const t = stripped.toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  const base = { companyQuery: "", confidence: 0.9, raw };
  if (!t || t.length < 2) return { intent: "UNKNOWN", risk: "LOW", companyQuery: "", confidence: 0.1, raw };

  const stop = classifyOwnerStopIntent(raw, { finalized: true, araSpeaking: true });
  if (stop.kind === "stop_conversation") return { ...base, intent: "STOP_LISTENING", risk: "LOW", confidence: 0.99 };
  if (stop.kind === "stop_speech") return { ...base, intent: "STOP_SPEECH", risk: "LOW", confidence: 0.99 };
  if (stop.kind === "stop_task") return { ...base, intent: "CANCEL", risk: "LOW", confidence: 0.99 };

  if (hit(t, /confirm send/)) return { ...base, intent: "CONFIRM", risk: "HIGH", confidence: 0.95 };
  if (hit(t, /confirm schedule/)) return { ...base, intent: "CONFIRM", risk: "HIGH", confidence: 0.95 };
  if (hit(t, /confirm$/)) return { ...base, intent: "CONFIRM", risk: "HIGH", confidence: 0.85 };

  if (hit(t, /send (the |that )?(email|message|it)/)) return { ...base, intent: "SEND_EMAIL", risk: "HIGH", confidence: 0.92 };
  if (hit(t, /read( me)? (their |the )?reply|what did they say/)) return { ...base, intent: "READ_REPLY", risk: "LOW" };
  if (hit(t, /draft a response|draft a reply|write a response/)) return { ...base, intent: "DRAFT_RESPONSE", risk: "LOW" };
  if (hit(t, /stop (their |the )?follow-?ups/)) return { ...base, intent: "STOP_FOLLOWUPS", risk: "MEDIUM" };
  if (isPersonalCalendarCommand(stripped)) {
    return { ...base, intent: "CREATE_OWNER_CALENDAR_EVENT", risk: "LOW", confidence: 0.98 };
  }
  if (isOwnerCalendarManageCommand(stripped)) {
    return { ...base, intent: "UNKNOWN", risk: "LOW", confidence: 0.2 };
  }
  if (hit(t, /when is my next (sales )?call|next sales call/)) return { ...base, intent: "NEXT_CALL", risk: "LOW" };
  if (hit(t, /what times am i (available|free)|available wednesday|free wednesday|open times/)) return { ...base, intent: "AVAILABILITY", risk: "LOW" };
  if (hit(t, /schedule (them|it|the call)|book (them|the call)/)) return { ...base, intent: "SCHEDULE_CALL", risk: "HIGH" };
  if (hit(t, /prepare me for the call|call prep|prep me/)) return { ...base, intent: "READ_CALL_OPENER", risk: "LOW", confidence: 0.95 };

  if (hit(t, /pull up (my |the )?calendar|show( me)? (my |the )?calendar|open (my |the )?calendar|go to (my |the )?calendar/)) {
    return { ...base, intent: "NAVIGATE_CALENDAR", risk: "LOW", confidence: 0.97 };
  }
  if (hit(t, /what (do i have|have i got) tomorrow|show( me)? tomorrow/)) {
    return { ...base, intent: "CALENDAR_DAY", risk: "LOW", confidence: 0.96, findVertical: "tomorrow" };
  }
  if (hit(t, /what (do i have|have i got) today|what calls do i have today/)) {
    return { ...base, intent: "CALENDAR_DAY", risk: "LOW", confidence: 0.96, findVertical: "today" };
  }
  if (hit(t, /what calls do i have this week|calls this week|show( me)? (the |this )?week/)) {
    return { ...base, intent: "CALENDAR_WEEK", risk: "LOW", confidence: 0.95 };
  }
  if (hit(t, /show( me)? (the |this )?month/)) return { ...base, intent: "CALENDAR_MONTH", risk: "LOW", confidence: 0.94 };
  if (hit(t, /go to next week|show( me)? next week|next week/)) return { ...base, intent: "CALENDAR_NEXT", risk: "LOW", confidence: 0.96 };
  if (hit(t, /go back to today|show( me)? today|^today$/)) return { ...base, intent: "CALENDAR_TODAY", risk: "LOW", confidence: 0.96 };
  if (hit(t, /do i have anything at|anything at \d/)) {
    return { ...base, intent: "CALENDAR_AT", risk: "LOW", confidence: 0.95, hour: parseSpokenHour(t) ?? undefined };
  }

  if (hit(t, /read everything( on (this |the )?(page|screen))?|read (the )?whole (page|screen)|read it all/)) {
    return { ...base, intent: "READ_EVERYTHING", risk: "LOW", confidence: 0.98 };
  }
  if (hit(t, /read (the |this )?(warning|error|blocker)|what does the warning say/)) {
    return { ...base, intent: "READ_WARNING", risk: "LOW", confidence: 0.97 };
  }
  if (hit(t, /read (the |this )?form|what('s| is) (on )?the form/)) {
    return { ...base, intent: "READ_FORM", risk: "LOW", confidence: 0.96 };
  }
  if (hit(t, /what are my options|what can i (do|press)|read (the |my )?options/)) {
    return { ...base, intent: "READ_OPTIONS", risk: "LOW", confidence: 0.96 };
  }
  if (hit(t, /read (this |the )?(page|screen)|read (this|it)( aloud)?|what does this say/)) {
    return { ...base, intent: "READ_PAGE", risk: "LOW", confidence: 0.97 };
  }

  if (hit(t, /what am i looking at|explain this screen|what does this (page |screen )?mean|what should i (care about|do next) here|what is this page|what does this mean|where are we( now)?|what page is this/)) {
    return { ...base, intent: "EXPLAIN_PROSPECT", risk: "LOW", confidence: 0.97 };
  }

  if (hit(t, /take me home|go (back )?home|back to home|open home|^home$/)) return { ...base, intent: "NAVIGATE_HOME", risk: "LOW", confidence: 0.96 };
  if (hit(t, /(open |go to |show (me )?)?(the )?pipeline\b|show( me)? (my )?prospects/)) {
    return { ...base, intent: "NAVIGATE_PIPELINE", risk: "LOW", confidence: 0.96 };
  }
  if (hit(t, /(open |go to |show (me )?)?settings\b/)) return { ...base, intent: "NAVIGATE_SETTINGS", risk: "LOW", confidence: 0.96 };

  if (hit(t, /what('s| is) next|start my tasks|start tasks|what needs me|what do i need|good morning/)) {
    if (hit(t, /what('s| is) next/)) return { ...base, intent: "NEXT_TASK", risk: "LOW" };
    if (hit(t, /start/)) return { ...base, intent: "START_TASKS", risk: "LOW" };
    return { ...base, intent: "GET_DAILY_TASKS", risk: "LOW" };
  }
  if (hit(t, /start my tasks|start tasks|yes start|let's start|lets start/)) return { ...base, intent: "START_TASKS", risk: "LOW" };
  if (hit(t, /^(next|next one)$|next (one|task|prospect)|go to the next|show me the next|open the next|move on/)) {
    return { ...base, intent: "NEXT_TASK", risk: "LOW" };
  }
  if (hit(t, /previous|go back to the last/)) return { ...base, intent: "PREVIOUS_TASK", risk: "LOW" };
  if (hit(t, /^(ok(ay)? )?got it$|^i understand$|^understood$/)) {
    return { ...base, intent: "ACKNOWLEDGE_TASK", risk: "LOW", confidence: 0.94 };
  }
  if (hit(t, /let me do this|take control|i'?ll (do|take) (it|this)|^(wait|hold on)$/)) {
    return { ...base, intent: "CANCEL", risk: "LOW", confidence: 0.95 };
  }
  if (hit(t, /give control|your turn|you take it|continue ara|keep going ara/)) {
    return { ...base, intent: "GIVE_CONTROL", risk: "LOW", confidence: 0.95 };
  }
  if (hit(t, /scroll down|scroll up|scroll a (bit|little)/)) {
    return { ...base, intent: "COMPUTER_SCROLL", risk: "LOW", confidence: 0.96 };
  }
  if (hit(t, /try again|retry it|^retry$|run the research again|research again|research more/)) {
    return { ...base, intent: "RESEARCH_FURTHER", risk: "LOW", confidence: 0.95 };
  }
  const listFilter = parseSpokenFilter(stripped);
  if (listFilter.kind === "filter") {
    return { ...base, intent: "FILTER_PROSPECTS", risk: "LOW", confidence: 0.97, filter: listFilter.filter };
  }
  if (listFilter.kind === "unknown") {
    return { ...base, intent: "FILTER_PROSPECTS", risk: "LOW", confidence: 0.99, filterUnknown: listFilter.reason };
  }
  if (listFilter.kind === "ask") {
    return { ...base, intent: "FILTER_PROSPECTS", risk: "LOW", confidence: 0.99, filterAsk: listFilter.ask };
  }
  if (hit(t, /press review|^review$|review this|review it|review this one|open (the )?review/)) {
    return { ...base, intent: "OPEN_REVIEW", risk: "LOW", confidence: 0.96 };
  }
  if (hit(t, /^skip$|skip this one|move past this company|skip (them|this|it|this company)|do not contact/)) {
    return { ...base, intent: "SKIP_PROSPECT", risk: "MEDIUM" };
  }

  const findN = t.match(/^(?:find(?: me)?|look for|search for)(?: (\d+))?\s+(.+?)\s+(?:companies |businesses |firms )?(?:in|near|around)\s+(.+)$/);
  if (findN) {
    const count = findN[1] ? Math.min(50, Math.max(1, parseInt(findN[1], 10))) : 20;
    return {
      ...base,
      intent: "FIND_CLIENTS",
      risk: "LOW",
      findCount: count,
      findVertical: findN[2].trim(),
      findLocation: findN[3].trim(),
    };
  }
  if (hit(t, /find clients|open find clients|look for clients/)) return { ...base, intent: "FIND_CLIENTS", risk: "LOW" };
  if (hit(t, /find companies|find \d+|find high-ticket/)) return { ...base, intent: "FIND_CLIENTS", risk: "LOW" };

  if (hit(t, /find (the |their |a )?(owner|decision[- ]maker|contact( person| method| info| information)?)|who (owns|is the owner)|look up (the |their )?owner/)) {
    const named = t.match(/(?:for|at|with|about) (.+)$/);
    const companyQuery = named && !THIS_RE.test(named[1]) ? named[1].trim() : "";
    return { ...base, intent: "FIND_CONTACT", risk: "LOW", confidence: 0.96, companyQuery };
  }

  if (hit(t, /open (their |the |this )?(web ?site|site|homepage)|visit (their |the )?web ?site/)) {
    const named = t.match(/(?:for|of) (.+)$/);
    return { ...base, intent: "OPEN_WEBSITE", risk: "LOW", confidence: 0.96, companyQuery: named ? named[1].trim() : "" };
  }

  const more = t.match(/^(?:tell me more|learn more|view what we know)(?: about (.+))?$/);
  if (more) {
    return { ...base, intent: "OPEN_REVIEW", risk: "LOW", confidence: 0.96, companyQuery: (more[1] || "").trim() };
  }

  const whatDo = t.match(/what should i do (?:with|about|for) (.+)/);
  if (whatDo) {
    return { ...base, intent: "EXPLAIN_PROSPECT", risk: "LOW", confidence: 0.96, companyQuery: whatDo[1].trim() };
  }

  if (hit(t, /go back|^back$/)) return { ...base, intent: "GO_BACK", risk: "LOW" };

  if (hit(t, /show( me)? (the )?evidence|see (the )?evidence|read the evidence/)) return { ...base, intent: "SHOW_EVIDENCE", risk: "LOW" };
  if (hit(t, /^show me$|show (me )?(that|this|it)$|show (me )?(the )?(explanation|explain panel|panel)$|put that on (the )?screen|show (it|that) on (the )?screen/)) {
    return { ...base, intent: "SHOW_EXPLAIN_PANEL", risk: "LOW", confidence: 0.96 };
  }
  if (hit(t, /^(close|dismiss)( it| that| the explanation| the panel)?$/)) {
    return { ...base, intent: "CLOSE_EXPLAIN", risk: "LOW", confidence: 0.9 };
  }
  if (hit(t, /explain( this| why| the score| this company| this to me)|why (do you like|this company)|what don'?t we know/)) {
    return { ...base, intent: "EXPLAIN_PROSPECT", risk: "LOW" };
  }

  if (hit(t, /show( me)? (their |the |this )?outreach|their outreach/)) return { ...base, intent: "OPEN_OUTREACH", risk: "LOW" };
  if (hit(t, /draft (an |the )?(email|outreach)|write (an |the )?email/)) return { ...base, intent: "DRAFT_OUTREACH", risk: "LOW" };

  if (hit(t, /research (them |it |this )?further|look them up further/)) return { ...base, intent: "RESEARCH_FURTHER", risk: "LOW" };
  if (hit(t, /research them|research this|look them up/)) return { ...base, intent: "RESEARCH_FURTHER", risk: "LOW" };

  if (hit(t, /read( me)? the (email|outreach|draft)|what('s| is) the email/)) return { ...base, intent: "READ_OUTREACH", risk: "LOW" };
  if (hit(t, /make (that |the )?email shorter|shorten the email/)) return { ...base, intent: "MAKE_EMAIL_SHORTER", risk: "LOW" };
  if (hit(t, /call opener|what should i say on the call|what to say/)) return { ...base, intent: "READ_CALL_OPENER", risk: "LOW" };

  if (hit(t, /^(call them|call this( one| company| business)?|call it|dial them|place the call|call the (listing )?number)$/) || hit(t, /\b(call them|dial them)\b/)) {
    return { ...base, intent: "CALL_PROSPECT", risk: "LOW", confidence: 0.96 };
  }
  const callNamed = t.match(/^call (.+)$/);
  if (callNamed && !/opener|prep|schedule|calendar|follow/.test(callNamed[1])) {
    const q = callNamed[1].trim();
    return { ...base, intent: "CALL_PROSPECT", risk: "LOW", confidence: 0.9, companyQuery: THIS_RE.test(q) ? "" : q };
  }

  if (hit(t, /approve (the |this )?prospect|approve them|approve this/)) return { ...base, intent: "APPROVE_PROSPECT", risk: "MEDIUM" };
  if (hit(t, /skip (them|this|it|this company)|do not contact/)) return { ...base, intent: "SKIP_PROSPECT", risk: "MEDIUM" };

  if (hit(t, /review (this|them|it|this one|this company)|open (the )?review/)) {
    return { ...base, intent: "OPEN_REVIEW", risk: "LOW" };
  }

  if (hit(t, /open the strongest|strongest prospect/)) return { ...base, intent: "OPEN_PROSPECT", companyQuery: "__strongest__", risk: "LOW" };

  const thisOpen = t.match(/^(open|show me|review) (this|them|it|this one|that one|this company)$/);
  if (thisOpen) return { ...base, intent: "OPEN_PROSPECT", companyQuery: "", risk: "LOW" };

  const open = t.match(/^(?:open|show me) (.+)$/);
  if (open) return { ...base, intent: "OPEN_PROSPECT", companyQuery: open[1].trim(), risk: "LOW", confidence: 0.8 };

  return { intent: "UNKNOWN", risk: "LOW", companyQuery: "", confidence: 0.2, raw };
}

export function resolveCompany(query: string, ctx: VoiceContext): { uids: string[]; needAsk: boolean } {
  const q = (query || "").toLowerCase().trim();
  if (!q || THIS_RE.test(q)) {
    if (ctx.openUid) return { uids: [ctx.openUid], needAsk: false };
    return { uids: [], needAsk: true };
  }
  const hits = ctx.companies.filter((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(" ")[0] || "___"));
  if (hits.length === 1) return { uids: [hits[0].uid], needAsk: false };
  if (hits.length > 1) return { uids: hits.map((h) => h.uid), needAsk: true };
  return { uids: [], needAsk: true };
}

export function needsTarget(intent: IntentName): boolean {
  return [
    "OPEN_PROSPECT", "OPEN_REVIEW", "OPEN_OUTREACH", "DRAFT_OUTREACH",
    "RESEARCH_FURTHER", "FIND_CONTACT", "OPEN_WEBSITE", "CALL_PROSPECT", "READ_OUTREACH",
    "APPROVE_PROSPECT", "SKIP_PROSPECT", "SHOW_EVIDENCE", "READ_CALL_OPENER",
    "MAKE_EMAIL_SHORTER", "SEND_EMAIL", "READ_REPLY", "DRAFT_RESPONSE", "STOP_FOLLOWUPS", "SCHEDULE_CALL",
  ].includes(intent);
}

export function confirmPhraseOk(text: string): boolean {
  const t = stripWake(text).toLowerCase().replace(/[?.!,]/g, "").trim();
  return t === "confirm send" || t === "confirm" || t === "confirm schedule";
}

export function confirmSendPhraseOk(text: string): boolean {
  const t = stripWake(text).toLowerCase().replace(/[?.!,]/g, "").trim();
  return t === "confirm send";
}

export function confirmSchedulePhraseOk(text: string): boolean {
  const t = stripWake(text).toLowerCase().replace(/[?.!,]/g, "").trim();
  return t === "confirm schedule";
}

export { riskOf };
