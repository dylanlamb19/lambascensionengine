import type { Risk } from "./types.ts";
import type { AppActionName, DeskState, DeskWorld } from "./desk-actions.ts";
import { stripWake } from "./intents.ts";

/** One visible Owner Mode button Ara is allowed to invoke. Never a DOM selector. */
export type ScreenAction = {
  id: string;
  tool: string;
  action: AppActionName;
  label: string;
  aliases: string[];
  risk: Risk;
};

export type ScreenName =
  | "HOME"
  | "TASKS"
  | "REVIEW"
  | "PIPELINE"
  | "FIND_CLIENTS"
  | "ADD_CLIENT"
  | "OUTREACH"
  | "CALL"
  | "PREP"
  | "SETTINGS"
  | "CALENDAR";

export function screenNameOf(state: DeskState): ScreenName {
  if (state.taskIx != null && (state.view === "home" || state.view === "pipe")) return "TASKS";
  if (state.view === "detail") return "REVIEW";
  if (state.view === "pipe") return "PIPELINE";
  if (state.view === "find") return "FIND_CLIENTS";
  if (state.view === "add") return "ADD_CLIENT";
  if (state.view === "outreach") return "OUTREACH";
  if (state.view === "call") return "CALL";
  if (state.view === "prep") return "PREP";
  if (state.view === "settings") return "SETTINGS";
  if (state.view === "calendar") return "CALENDAR";
  return "HOME";
}

export function currentTask(state: DeskState, world: DeskWorld) {
  if (state.taskIx != null) return world.tasks[state.taskIx] || null;
  if (state.view === "home" && world.tasks[0]) return world.tasks[0];
  return null;
}

export function currentTaskUid(state: DeskState, world: DeskWorld): string | null {
  return currentTask(state, world)?.uid || state.openUid;
}

function act(
  id: string,
  tool: string,
  action: AppActionName,
  label: string,
  aliases: string[],
  risk: Risk = "LOW",
): ScreenAction {
  return { id, tool, action, label, aliases, risk };
}

const NAV: ScreenAction[] = [
  act("NAVIGATE_HOME", "navigate_home", "NAVIGATE_HOME", "Home", ["go home", "take me home", "home"]),
  act("NAVIGATE_PIPELINE", "navigate_pipeline", "NAVIGATE_PIPELINE", "Pipeline", ["open pipeline", "go to pipeline", "pipeline"]),
  act("NAVIGATE_SETTINGS", "navigate_settings", "NAVIGATE_SETTINGS", "Settings", ["open settings", "go to settings", "settings"]),
  act("NAVIGATE_CALENDAR", "navigate_calendar", "NAVIGATE_CALENDAR", "Calendar", ["pull up my calendar", "show me my calendar", "open calendar", "calendar"]),
  act("OPEN_FIND_CLIENTS", "open_find_clients", "OPEN_FIND_CLIENTS", "Find Clients", ["find clients", "open find clients"]),
  act("START_TASKS", "start_my_tasks", "START_TASKS", "Start My Tasks", ["start my tasks", "start tasks"]),
  act("GO_BACK", "go_back", "GO_BACK", "Back", ["go back", "back"]),
  act("EXPLAIN", "explain_current_screen", "EXPLAIN", "Explain this", ["explain this", "explain this to me", "explain"]),
  act("READ_PAGE", "read_current_screen", "READ_PAGE", "Read page", ["read this page", "read the page", "what does this say", "read it"]),
];

/** Registered buttons on the screen that is actually visible now. */
export function labeledActionsFor(state: DeskState, world: DeskWorld): ScreenAction[] {
  const screen = screenNameOf(state);
  const task = currentTask(state, world);
  const out: ScreenAction[] = [...NAV];

  if (screen === "HOME") {
    const first = world.tasks[0];
    if (first?.uid) {
      out.unshift(
        act("LEARN_MORE_HOME", "learn_more", "OPEN_REVIEW", "Learn More", ["learn more", "tell me more", "view what we know", "review", "press review", "open the review"]),
        act("FIND_CONTACT_HOME", "find_contact", "FIND_CONTACT", "Find Contact", ["find contact", "find the owner", "find their contact", "look up the owner"]),
        act("OPEN_WEBSITE_HOME", "open_website", "OPEN_WEBSITE", "Open Website", ["open website", "open their website", "open the website", "visit their website"]),
        act("CALL_HOME", "call_prospect", "CALL_PROSPECT", "Call", ["call", "call them", "call this number", "dial"]),
        act("SKIP_HOME", "skip_current_task", "SKIP_CURRENT_TASK", "Skip", ["skip", "skip this", "skip this one", "skip them"], "MEDIUM"),
      );
    }
  }

  if (screen === "TASKS" && task) {
    out.unshift(
      act("REVIEW_CURRENT_TASK", "review_current_task", "REVIEW_CURRENT_TASK", "Learn More", ["learn more", "tell me more", "view what we know", "review", "press review", "review this", "review it", "review this one", "open the review", "open review"]),
      act("FIND_CONTACT", "find_contact", "FIND_CONTACT", "Find Contact", ["find contact", "find the owner", "find their contact", "look up the owner"]),
      act("OPEN_WEBSITE", "open_website", "OPEN_WEBSITE", "Open Website", ["open website", "open their website", "open the website", "visit their website"]),
      act("CALL_PROSPECT", "call_prospect", "CALL_PROSPECT", "Call", ["call", "call them", "call this number", "dial"]),
      act("SKIP_CURRENT_TASK", "skip_current_task", "SKIP_CURRENT_TASK", "Skip", ["skip", "skip this", "skip this one", "skip them", "move past this company"], "MEDIUM"),
      act("ACKNOWLEDGE_CURRENT_TASK", "acknowledge_current_task", "ACKNOWLEDGE_TASK", "Got it", ["got it", "okay got it", "ok got it", "i understand", "understood"]),
      act("NEXT_TASK", "next_task", "NEXT_TASK", "Next", ["next", "next task", "what's next", "whats next", "move on"]),
      act("PREVIOUS_TASK", "previous_task", "PREVIOUS_TASK", "Previous", ["previous", "previous task", "go back to the last"]),
    );
    if (task.retry) {
      out.unshift(
        act("RETRY_CURRENT_TASK", "retry_current_task", "RETRY_CURRENT_TASK", "Try Research Again", ["try again", "try research again", "retry", "retry it", "run the research again", "research again"]),
      );
    }
  }

  if (screen === "REVIEW") {
    out.unshift(
      act("LEARN_MORE", "learn_more", "OPEN_REVIEW", "Learn More", ["learn more", "tell me more", "view what we know"]),
      act("FIND_CONTACT_REVIEW", "find_contact", "FIND_CONTACT", "Find Contact", ["find contact", "find the owner", "find their contact"]),
      act("OPEN_WEBSITE_REVIEW", "open_website", "OPEN_WEBSITE", "Open Website", ["open website", "open their website", "open the website"]),
      act("CALL_REVIEW", "call_prospect", "CALL_PROSPECT", "Call", ["call", "call them", "dial"]),
      act("APPROVE_PROSPECT", "approve_prospect", "APPROVE_PROSPECT", "Approve", ["approve", "approve them", "approve this"], "MEDIUM"),
      act("SKIP_PROSPECT", "skip_prospect", "SKIP_PROSPECT", "Skip", ["skip", "skip this one", "skip them"], "MEDIUM"),
      act("RESEARCH_MORE", "research_further", "RESEARCH_FURTHER", "Try Research Again", ["research more", "try again", "try research again", "retry", "research further"]),
      act("SHOW_EVIDENCE", "show_evidence", "SHOW_EVIDENCE", "See Evidence", ["show me the evidence", "show evidence", "see evidence", "evidence"]),
      act("OPEN_OUTREACH", "open_outreach", "OPEN_OUTREACH", "Outreach", ["show outreach", "open outreach", "draft outreach"]),
      act("NEXT_TASK", "next_task", "NEXT_TASK", "Next", ["next", "next task", "what's next", "move on"]),
    );
  }

  if (screen === "FIND_CLIENTS") {
    out.unshift(
      act("SET_FIND_FORM", "set_find_clients_form", "SET_FIND_FORM", "Fill form", ["set company type", "set location", "set count"]),
      act("RUN_FIND_CLIENTS", "run_find_clients", "RUN_FIND_CLIENTS", "Find Clients", ["run find", "search", "find clients"]),
      act("CANCEL_FIND", "go_back", "GO_BACK", "Cancel", ["cancel", "cancel find"]),
    );
  }

  if (screen === "PIPELINE") {
    out.unshift(
      act("OPEN_PROSPECT", "open_prospect", "OPEN_PROSPECT", "Review", ["review", "open this one", "open prospect"]),
      act("FILTER_PROSPECTS", "filter_prospects", "FILTER_PROSPECTS", "Clear filters", ["clear filters", "show everything", "show all prospects", "reset the list", "start over"]),
      act("NEXT_TASK", "next_task", "NEXT_TASK", "Next", ["next", "open the next"]),
    );
  }

  if (screen === "CALENDAR") {
    out.unshift(
      act("CALENDAR_TODAY", "calendar_today", "CALENDAR_TODAY", "Today", ["today", "go back to today", "show today"]),
      act("CALENDAR_PREV", "calendar_prev", "CALENDAR_PREV", "Previous", ["previous", "last week"]),
      act("CALENDAR_NEXT", "calendar_next", "CALENDAR_NEXT", "Next", ["next", "next week", "show me next week"]),
      act("CALENDAR_WEEK", "calendar_set_view", "CALENDAR_SET_VIEW", "Week", ["week", "this week"]),
      act("OPEN_PROSPECT", "open_prospect", "OPEN_PROSPECT", "Open Prospect", ["open them", "open the prospect"]),
      act("READ_CALL_OPENER", "get_next_call", "READ_CALL_OPENER", "Call Prep", ["prepare me for the call", "call prep"]),
    );
  }

  if (screen === "OUTREACH") {
    out.unshift(
      act("PREPARE_SEND", "send_email", "PREPARE_SEND", "Approve & Send", ["send", "send that email"], "HIGH"),
      act("STOP_FOLLOWUPS", "stop_followups", "STOP_FOLLOWUPS", "Stop follow-ups", ["stop follow-ups", "stop their follow-ups"], "MEDIUM"),
    );
  }

  const seen = new Set<string>();
  return out.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

export function normalizeSpokenLabel(raw: string): string {
  return stripWake(raw)
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(please )?(press|click|tap|hit|select|choose) (the |that |this )?/, "")
    .trim();
}

export function matchSpokenLabel(
  raw: string,
  actions: ScreenAction[],
): { match: ScreenAction } | { ambiguous: true; labels: string[] } | { none: true } {
  const t = normalizeSpokenLabel(raw);
  if (!t || t.length < 2) return { none: true };
  const hits = actions.filter((a) => {
    const keys = [a.label, ...a.aliases].map((x) => x.toLowerCase());
    return keys.some((k) => k === t || t === `the ${k}`);
  });
  if (hits.length === 1) return { match: hits[0] };
  if (hits.length > 1) return { ambiguous: true, labels: [...new Set(hits.map((h) => h.label))] };
  return { none: true };
}
