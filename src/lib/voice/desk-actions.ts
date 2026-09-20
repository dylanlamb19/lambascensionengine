import type { IntentName, OwnerView, ParsedIntent } from "./types.ts";
import { needsTarget, parseSpokenCommand, resolveCompany } from "./intents.ts";
import type { ToolPlan } from "./tools.ts";
import { mapSpokenVertical } from "../discovery/places.ts";
import { currentTask, currentTaskUid, labeledActionsFor, matchSpokenLabel } from "./screen-actions.ts";
import { addDays, hourOf, shiftAnchor, ymdInTz, type CalView } from "../calendar/range.ts";
import { buildScreenContext, explainScreen } from "./screen-context.ts";
import { readScreen } from "./read-screen.ts";
import {
  applyLayoutCommand,
  DEFAULT_HOME_LAYOUT,
  parseLayoutCommand,
  type HomeLayout,
  type HomeWidget,
} from "./layout.ts";
import {
  applyVisualCommand,
  DEFAULT_VISUAL_THEME,
  parseVisualCommand,
  type VisualCommand,
  type VisualTheme,
} from "../visual/theme.ts";
import {
  confirmGenerateSpeech,
  currentGalleryItem,
  EMPTY_GALLERY,
  matchGalleryQuery,
  parseImageCommand,
  type GalleryState,
  type ImageCommand,
} from "../visual/gallery.ts";

/**
 * Allowlisted Owner Mode actions. Ara and the buttons call the same names.
 * Never add a DOM-click / eval / arbitrary script action here.
 */
export const APP_ACTIONS = [
  "NAVIGATE_HOME",
  "NAVIGATE_PIPELINE",
  "NAVIGATE_SETTINGS",
  "NAVIGATE_CALENDAR",
  "CALENDAR_TODAY",
  "CALENDAR_NEXT",
  "CALENDAR_PREV",
  "CALENDAR_SET_VIEW",
  "OPEN_CALENDAR_EVENT",
  "OPEN_FIND_CLIENTS",
  "OPEN_ADD_CLIENT",
  "OPEN_PROSPECT",
  "OPEN_REVIEW",
  "SHOW_EVIDENCE",
  "START_TASKS",
  "NEXT_TASK",
  "PREVIOUS_TASK",
  "REVIEW_CURRENT_TASK",
  "RETRY_CURRENT_TASK",
  "SKIP_CURRENT_TASK",
  "ACKNOWLEDGE_TASK",
  "SKIP_PROSPECT",
  "APPROVE_PROSPECT",
  "DRAFT_OUTREACH",
  "OPEN_OUTREACH",
  "READ_OUTREACH",
  "OPEN_WEBSITE",
  "CALL_PROSPECT",
  "FIND_CONTACT",
  "STOP_FOLLOWUPS",
  "EXPLAIN",
  "CLOSE_EXPLAIN",
  "READ_PAGE",
  "READ_EVERYTHING",
  "READ_WARNING",
  "READ_FORM",
  "READ_OPTIONS",
  "GO_BACK",
  "RUN_FIND_CLIENTS",
  "SET_FIND_FORM",
  "RESEARCH_FURTHER",
  "READ_CALL_OPENER",
  "MAKE_EMAIL_SHORTER",
  "PREPARE_SEND",
  "PREPARE_SCHEDULE",
  "GET_DAILY_TASKS",
  "AVAILABILITY",
  "NEXT_CALL",
  "DRAFT_REPLY",
  "READ_REPLY",
  "CANCEL",
  "STOP_LISTENING",
  "LAYOUT",
  "VISUAL",
  "IMAGE",
  "SCROLL_PAGE",
] as const;

export type AppActionName = (typeof APP_ACTIONS)[number];

export type AppAction = {
  name: AppActionName;
  uid?: string | null;
  findVertical?: string;
  findLocation?: string;
  findCount?: number;
  silent?: boolean;
  calendarView?: CalView;
  eventId?: string;
  hour?: number;
  widget?: HomeWidget;
  layoutKind?: "move" | "hide" | "show" | "emphasis" | "clean" | "nav_calendar";
  layoutPlace?: "top" | "bottom" | "higher" | "lower";
  dy?: number;
  showPanel?: boolean;
  visual?: VisualCommand;
  image?: ImageCommand;
  readMode?: "page" | "everything" | "warning" | "form" | "options";
};

/** Shared action → Ara tool name. Buttons and Ara both end here. */
export const ACTION_TO_TOOL: Record<AppActionName, string> = {
  NAVIGATE_HOME: "navigate_home",
  NAVIGATE_PIPELINE: "navigate_pipeline",
  NAVIGATE_SETTINGS: "navigate_settings",
  NAVIGATE_CALENDAR: "navigate_calendar",
  CALENDAR_TODAY: "calendar_today",
  CALENDAR_NEXT: "calendar_next",
  CALENDAR_PREV: "calendar_prev",
  CALENDAR_SET_VIEW: "calendar_set_view",
  OPEN_CALENDAR_EVENT: "open_calendar_event",
  OPEN_FIND_CLIENTS: "open_find_clients",
  OPEN_ADD_CLIENT: "open_add_client",
  OPEN_PROSPECT: "open_prospect",
  OPEN_REVIEW: "open_review",
  SHOW_EVIDENCE: "show_evidence",
  START_TASKS: "start_my_tasks",
  NEXT_TASK: "next_task",
  PREVIOUS_TASK: "previous_task",
  REVIEW_CURRENT_TASK: "review_current_task",
  RETRY_CURRENT_TASK: "retry_current_task",
  SKIP_CURRENT_TASK: "skip_current_task",
  ACKNOWLEDGE_TASK: "acknowledge_current_task",
  SKIP_PROSPECT: "skip_prospect",
  APPROVE_PROSPECT: "approve_prospect",
  DRAFT_OUTREACH: "draft_outreach",
  OPEN_OUTREACH: "open_outreach",
  READ_OUTREACH: "read_outreach",
  OPEN_WEBSITE: "open_website",
  CALL_PROSPECT: "call_prospect",
  FIND_CONTACT: "find_contact",
  STOP_FOLLOWUPS: "stop_followups",
  EXPLAIN: "explain_current_screen",
  CLOSE_EXPLAIN: "close_explain_panel",
  READ_PAGE: "read_current_screen",
  READ_EVERYTHING: "read_everything_on_screen",
  READ_WARNING: "read_current_screen",
  READ_FORM: "read_current_screen",
  READ_OPTIONS: "read_current_screen",
  GO_BACK: "go_back",
  RUN_FIND_CLIENTS: "run_find_clients",
  SET_FIND_FORM: "set_find_clients_form",
  RESEARCH_FURTHER: "research_further",
  READ_CALL_OPENER: "get_next_call",
  MAKE_EMAIL_SHORTER: "draft_outreach",
  PREPARE_SEND: "send_email",
  PREPARE_SCHEDULE: "schedule_call",
  GET_DAILY_TASKS: "get_daily_tasks",
  AVAILABILITY: "get_calendar_availability",
  NEXT_CALL: "get_next_call",
  DRAFT_REPLY: "draft_reply",
  READ_REPLY: "get_reply",
  CANCEL: "go_back",
  STOP_LISTENING: "go_back",
  LAYOUT: "rearrange_home",
  VISUAL: "set_page_background",
  IMAGE: "generate_image",
  SCROLL_PAGE: "computer_scroll",
};

export type NavFrame = {
  view: OwnerView;
  openUid: string | null;
  evidence: boolean;
};

export type DeskState = {
  view: OwnerView;
  openUid: string | null;
  evidence: boolean;
  advanced: boolean;
  taskIx: number | null;
  vert: string;
  city: string;
  findLimit: number;
  stack: NavFrame[];
  explainOpen: boolean;
  lastSpoken: string;
  lastAction: AppActionName | null;
  calView: CalView;
  calAnchor: string;
  calEventId: string | null;
  layout: HomeLayout;
  visual: VisualTheme;
  gallery: GalleryState;
};

export type VisibleCalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  prospectUid?: string | null;
  companyName?: string | null;
  kind: "sales_call" | "google";
};

export type DeskWorld = {
  prospects: { uid: string; name: string; score: number; stage_plain?: string; website?: string; phone?: string }[];
  tasks: { title: string; plain: string; uid?: string; id?: string; retry?: boolean }[];
  gmail?: import("../mail/integration-status.ts").ConnectionHealth;
  calendarStatus?: import("../mail/integration-status.ts").ConnectionHealth;
  calendarUnreadable?: boolean;
  calendarReason?: string;
  calendarRange?: string;
  calEvents?: VisibleCalEvent[];
  nextCall?: { prospectUid: string; start: string; title: string; companyName?: string } | null;
  findMsg?: string;
  testMode?: boolean;
  discoveryConfigured?: boolean | null;
  missingIntegrations?: { name: string; ready: boolean }[];
  integration?: import("../mail/integration-status.ts").IntegrationStatus;
  testLoop?: import("../mail/test-loop.ts").TestLoopState;
};

export type DeskEffect =
  | { type: "none" }
  | { type: "run_find"; vertical: string; location: string; count: number }
  | { type: "research"; uid: string }
  | { type: "stop_followups"; uid: string }
  | { type: "approve"; uid: string }
  | { type: "skip"; uid: string }
  | { type: "availability" }
  | { type: "next_call" }
  | { type: "shorten_email"; uid: string }
  | { type: "generate_outreach"; uid: string }
  | { type: "arm"; intent: IntentName; uid: string; phrase: string }
  | { type: "cancel_arm" }
  | { type: "scroll"; dy: number }
  | { type: "visual_generate"; prompt: string; nsfw: boolean; aspectRatio?: string; quality?: string; style?: string }
  | { type: "pick_background"; nsfw?: boolean }
  | { type: "open_url"; url: string }
  | { type: "dial"; phone: string }
  | { type: "image_generate"; prompt: string; n: number; kind: GalleryState["lastKind"]; nsfw: boolean; asBackground?: boolean; aspectRatio?: string; quality?: string; style?: string; intendedUse?: string }
  | { type: "image_favorite"; id: string; favorite: boolean }
  | { type: "image_save"; id: string }
  | { type: "image_to_ad"; id: string }
  | { type: "image_delete"; id: string };

export function emptyDesk(partial?: Partial<DeskState>): DeskState {
  return {
    view: "home",
    openUid: null,
    evidence: false,
    advanced: false,
    taskIx: null,
    vert: "Roofing",
    city: "Fort Worth",
    findLimit: 20,
    stack: [],
    explainOpen: false,
    lastSpoken: "",
    lastAction: null,
    calView: "week",
    calAnchor: ymdInTz(),
    calEventId: null,
    layout: DEFAULT_HOME_LAYOUT,
    visual: DEFAULT_VISUAL_THEME,
    gallery: { ...EMPTY_GALLERY },
    ...partial,
  };
}

function prettyPlace(s: string): string {
  return (s || "").replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function nameOf(world: DeskWorld, uid: string | null | undefined): string {
  if (!uid) return "this company";
  return world.prospects.find((p) => p.uid === uid)?.name || "this company";
}

function push(state: DeskState, nextView: OwnerView): NavFrame[] {
  if (state.view === nextView && nextView !== "detail") return state.stack;
  return [...state.stack, { view: state.view, openUid: state.openUid, evidence: state.evidence }].slice(-12);
}

function speak(state: DeskState, action: AppAction, text: string): string {
  return action.silent ? state.lastSpoken : text;
}

export function availableActions(state: DeskState): AppActionName[] {
  return labeledActionsFor(state, { prospects: [], tasks: [] }).map((a) => a.action);
}

export function availableToolNames(state: DeskState, world?: DeskWorld): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of labeledActionsFor(state, world || { prospects: [], tasks: [] })) {
    if (!seen.has(a.tool)) {
      seen.add(a.tool);
      out.push(a.tool);
    }
  }
  return out;
}

export function screenContext(state: DeskState, world: DeskWorld, extras?: { confirmationOpen?: boolean; testMode?: boolean }) {
  const brief = buildScreenContext(state, { ...world, testMode: extras?.testMode ?? world.testMode }, extras);
  const task = currentTask(state, world);
  const uid = currentTaskUid(state, world);
  const company = world.prospects.find((p) => p.uid === (uid || state.openUid));
  return {
    ...brief,
    view: state.view,
    openUid: uid || state.openUid,
    companyName: company?.name || task?.title || null,
    pipelineStage: company?.stage_plain || null,
    currentTask: task?.title || null,
    taskId: task?.id || (state.taskIx != null ? String(state.taskIx) : null),
    taskIndex: state.taskIx,
    taskUid: task?.uid || null,
    confirmationOpen: Boolean(extras?.confirmationOpen),
    evidenceOpen: state.evidence,
    testMode: extras?.testMode !== false,
    lookingAt: brief.lookingAt,
    important: brief.important,
    next: brief.next,
    facts: brief.facts,
    explain: explainScreen(brief),
  };
}

export function applyDeskAction(state: DeskState, action: AppAction, world: DeskWorld): { state: DeskState; effect: DeskEffect } {
  const spoken = (text: string) => speak(state, action, text);
  const withAction = (next: Partial<DeskState>, effect: DeskEffect = { type: "none" }) => {
    const viewChanged = next.view !== undefined && next.view !== state.view;
    const uidChanged = next.openUid !== undefined && next.openUid !== state.openUid;
    const leaveExplain = (viewChanged || uidChanged) && action.name !== "EXPLAIN";
    return {
      state: {
        ...state,
        lastAction: action.name,
        ...(leaveExplain ? { explainOpen: false } : {}),
        ...next,
      },
      effect,
    };
  };

  switch (action.name) {
    case "NAVIGATE_HOME":
      return withAction({
        view: "home",
        evidence: false,
        taskIx: null,
        stack: push(state, "home"),
        lastSpoken: spoken("Opening Home."),
      });
    case "NAVIGATE_PIPELINE":
      return withAction({
        view: "pipe",
        evidence: false,
        stack: push(state, "pipe"),
        lastSpoken: spoken("Opening Pipeline."),
      });
    case "NAVIGATE_SETTINGS":
      return withAction({
        view: "settings",
        stack: push(state, "settings"),
        lastSpoken: spoken("Opening Settings."),
      });
    case "NAVIGATE_CALENDAR":
      return withAction({
        view: "calendar",
        evidence: false,
        taskIx: null,
        calView: action.calendarView || state.calView || "week",
        calAnchor: action.calendarView === "day" && action.hour == null ? state.calAnchor : state.calAnchor,
        stack: push(state, "calendar"),
        lastSpoken: spoken("Opening Calendar."),
      });
    case "CALENDAR_TODAY":
      return withAction({
        view: "calendar",
        calAnchor: ymdInTz(),
        calEventId: null,
        stack: push(state, "calendar"),
        lastSpoken: spoken("Showing today."),
      });
    case "CALENDAR_NEXT":
      return withAction({
        view: "calendar",
        calAnchor: shiftAnchor(state.calView, state.calAnchor, 1),
        calEventId: null,
        stack: push(state, "calendar"),
        lastSpoken: spoken(state.calView === "week" ? "Showing next week." : "Moving forward."),
      });
    case "CALENDAR_PREV":
      return withAction({
        view: "calendar",
        calAnchor: shiftAnchor(state.calView, state.calAnchor, -1),
        calEventId: null,
        stack: push(state, "calendar"),
        lastSpoken: spoken("Going back on the calendar."),
      });
    case "CALENDAR_SET_VIEW": {
      const view = action.calendarView || "week";
      let anchor = state.calAnchor;
      if (action.findVertical === "tomorrow") anchor = addDays(ymdInTz(), 1);
      if (action.findVertical === "today") anchor = ymdInTz();
      let eventId = state.calEventId;
      let said = view === "day" ? "Showing the day view." : view === "month" ? "Showing the month." : "Showing the week.";
      if (action.hour != null) {
        const hits = (world.calEvents || []).filter((e) => hourOf(e.start) === action.hour);
        eventId = hits[0]?.id || null;
        said = hits.length
          ? `Yes — ${hits.map((h) => `${h.companyName || h.title} at ${action.hour}`).join("; ")}.`
          : "Nothing at that time in this view. I’m not guessing.";
      }
      return withAction({
        view: "calendar",
        calView: view,
        calAnchor: anchor,
        calEventId: eventId,
        stack: push(state, "calendar"),
        lastSpoken: spoken(said),
      });
    }
    case "OPEN_CALENDAR_EVENT": {
      const ev = (world.calEvents || []).find((e) => e.id === action.eventId);
      const uid = ev?.prospectUid || action.uid || null;
      if (uid && action.findVertical === "prep") {
        return withAction({
          view: "prep",
          openUid: uid,
          calEventId: action.eventId || state.calEventId,
          stack: push(state, "prep"),
          lastSpoken: spoken(`Opening call prep for ${nameOf(world, uid)}.`),
        });
      }
      if (uid && (action.findVertical === "open" || !ev)) {
        return withAction({
          view: "detail",
          openUid: uid,
          stack: push(state, "detail"),
          lastSpoken: spoken(`Opening ${nameOf(world, uid)}.`),
        });
      }
      return withAction({
        view: "calendar",
        calEventId: action.eventId || null,
        lastSpoken: spoken(ev ? `${ev.companyName || ev.title}.` : "I don’t see that event."),
      });
    }
    case "OPEN_FIND_CLIENTS":
      return withAction({
        view: "find",
        stack: push(state, "find"),
        lastSpoken: spoken("Opening Find Clients."),
      });
    case "OPEN_ADD_CLIENT":
      return withAction({
        view: "add",
        stack: push(state, "add"),
        lastSpoken: spoken("Opening Add Client."),
      });
    case "OPEN_PROSPECT":
    case "OPEN_REVIEW":
    case "REVIEW_CURRENT_TASK": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) {
        return withAction({ lastSpoken: spoken("Which company do you mean?") });
      }
      return withAction({
        view: "detail",
        openUid: uid,
        evidence: false,
        advanced: false,
        stack: state.view === "detail" ? state.stack : push(state, "detail"),
        lastSpoken: spoken(`Opening ${nameOf(world, uid)}.`),
      });
    }
    case "SHOW_EVIDENCE": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction({
        view: "detail",
        openUid: uid,
        evidence: true,
        stack: state.view === "detail" ? state.stack : push(state, "detail"),
        lastSpoken: spoken("Showing the evidence."),
      });
    }
    case "START_TASKS": {
      if (!world.tasks.length) {
        return withAction({ taskIx: null, lastSpoken: spoken("Nothing waiting on you.") });
      }
      const first = world.tasks[0];
      return withAction({
        view: "home",
        taskIx: 0,
        openUid: first.uid || state.openUid,
        evidence: false,
        explainOpen: false,
        lastSpoken: spoken(`${first.title}. ${first.plain}`),
      });
    }
    case "NEXT_TASK": {
      if (state.taskIx != null) {
        const next = state.taskIx + 1;
        const t = world.tasks[next];
        if (!t) return withAction({ lastSpoken: spoken("That was the last one.") });
        return withAction({
          view: "home",
          taskIx: next,
          openUid: t.uid || state.openUid,
          evidence: false,
          lastSpoken: spoken(t.title),
        });
      }
      if ((state.view === "detail" || state.view === "pipe") && world.prospects.length) {
        const ix = Math.max(0, world.prospects.findIndex((p) => p.uid === state.openUid));
        const nxt = world.prospects[state.openUid ? ix + 1 : 0];
        if (!nxt) return withAction({ lastSpoken: spoken("That was the last one.") });
        return withAction({
          view: "detail",
          openUid: nxt.uid,
          evidence: false,
          stack: push(state, "detail"),
          lastSpoken: spoken(`Opening ${nxt.name}.`),
        });
      }
      if (world.tasks.length) {
        return applyDeskAction(state, { ...action, name: "START_TASKS" }, world);
      }
      return withAction({ lastSpoken: spoken("Nothing waiting on you.") });
    }
    case "PREVIOUS_TASK": {
      if (state.taskIx == null || state.taskIx <= 0) {
        return withAction({ lastSpoken: spoken("You're already at the first one.") });
      }
      const prev = state.taskIx - 1;
      const t = world.tasks[prev];
      return withAction({
        view: "home",
        taskIx: prev,
        openUid: t?.uid || state.openUid,
        evidence: false,
        lastSpoken: spoken(t?.title || "Back to the first one."),
      });
    }
    case "RETRY_CURRENT_TASK": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "detail",
          openUid: uid,
          lastSpoken: spoken(`Trying research again for ${nameOf(world, uid)}.`),
        },
        { type: "research", uid },
      );
    }
    case "SKIP_CURRENT_TASK": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) {
        return applyDeskAction(state, { ...action, name: "NEXT_TASK" }, world);
      }
      const next = state.taskIx != null ? world.tasks[state.taskIx + 1] : null;
      return withAction(
        {
          view: "home",
          openUid: next?.uid || uid,
          taskIx: next ? (state.taskIx || 0) + 1 : null,
          evidence: false,
          lastSpoken: spoken(`${nameOf(world, uid)} is on Do Not Contact.`),
        },
        { type: "skip", uid },
      );
    }
    case "ACKNOWLEDGE_TASK": {
      return withAction({
        taskIx: null,
        explainOpen: false,
        lastSpoken: spoken("Got it."),
      });
    }
    case "GO_BACK": {
      if (state.explainOpen) {
        return withAction({ explainOpen: false, lastSpoken: spoken("Going back.") });
      }
      if (state.taskIx != null && state.view !== "home") {
        const t = currentTask(state, world);
        return withAction({
          view: "home",
          evidence: false,
          openUid: t?.uid || state.openUid,
          lastSpoken: spoken("Back to the current task."),
        });
      }
      if (state.evidence) {
        return withAction({ evidence: false, lastSpoken: spoken("Going back.") });
      }
      if (state.view !== "home") {
        const frame = state.stack[state.stack.length - 1];
        if (!frame) {
          return withAction({ view: "home", evidence: false, lastSpoken: spoken("Opening Home.") });
        }
        return withAction({
          view: frame.view,
          openUid: frame.openUid,
          evidence: frame.evidence,
          stack: state.stack.slice(0, -1),
          lastSpoken: spoken("Going back."),
        });
      }
      if (state.taskIx != null) {
        return withAction({ taskIx: null, lastSpoken: spoken("Going back.") });
      }
      return withAction({ view: "home", evidence: false, lastSpoken: spoken("Opening Home.") });
    }
    case "SET_FIND_FORM": {
      const vertical = action.findVertical ? mapSpokenVertical(action.findVertical) : state.vert;
      const location = action.findLocation ? prettyPlace(action.findLocation) : state.city;
      const count = action.findCount || state.findLimit;
      return withAction({
        view: "find",
        vert: vertical,
        city: location,
        findLimit: count,
        stack: push(state, "find"),
        lastSpoken: spoken(`Find Clients is set to ${count} ${vertical} in ${location}.`),
      });
    }
    case "RUN_FIND_CLIENTS": {
      const vertical = mapSpokenVertical(action.findVertical || state.vert);
      const location = prettyPlace(action.findLocation || state.city);
      const count = action.findCount || state.findLimit;
      if (!vertical || !location) {
        return withAction({
          view: "find",
          stack: push(state, "find"),
          lastSpoken: spoken("What kind of company, and where?"),
        });
      }
      return withAction(
        {
          view: "find",
          vert: vertical,
          city: location,
          findLimit: count,
          stack: push(state, "find"),
          lastSpoken: spoken(`Looking for ${count} ${vertical} companies in ${location}.`),
        },
        { type: "run_find", vertical, location, count },
      );
    }
    case "OPEN_OUTREACH":
    case "DRAFT_OUTREACH":
    case "READ_OUTREACH": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "outreach",
          openUid: uid,
          stack: push(state, "outreach"),
          lastSpoken: spoken(`Opening outreach for ${nameOf(world, uid)}.`),
        },
        { type: "generate_outreach", uid },
      );
    }
    case "READ_CALL_OPENER": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "call",
          openUid: uid,
          stack: push(state, "call"),
          lastSpoken: spoken("Opening the call opener."),
        },
        { type: "generate_outreach", uid },
      );
    }
    case "MAKE_EMAIL_SHORTER": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "outreach",
          openUid: uid,
          lastSpoken: spoken("I shortened the draft. It was not sent."),
        },
        { type: "shorten_email", uid },
      );
    }
    case "RESEARCH_FURTHER":
    case "FIND_CONTACT": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "detail",
          openUid: uid,
          lastSpoken: spoken(action.name === "FIND_CONTACT"
            ? `Looking for a decision maker at ${nameOf(world, uid)}. Public sources only. I will not guess an email.`
            : `Researching ${nameOf(world, uid)} further. I’ll use public sources only.`),
        },
        { type: "research", uid },
      );
    }
    case "OPEN_WEBSITE": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      const site = (world.prospects.find((p) => p.uid === uid)?.website || "").trim();
      let url = "";
      try {
        if (site && site.toUpperCase() !== "UNKNOWN") {
          url = new URL(site.includes("://") ? site : `https://${site}`).toString();
          if (!url.startsWith("http://") && !url.startsWith("https://")) url = "";
        }
      } catch { url = ""; }
      if (!url) return withAction({ lastSpoken: spoken(`No verified website on file for ${nameOf(world, uid)}.`) });
      return withAction(
        { lastSpoken: spoken(`Opening the website we have on file for ${nameOf(world, uid)}.`) },
        { type: "open_url", url },
      );
    }
    case "CALL_PROSPECT": {
      const uid = action.uid || currentTaskUid(state, world);
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      const phone = (world.prospects.find((p) => p.uid === uid)?.phone || "").trim();
      if (!phone || phone.toUpperCase() === "UNKNOWN") {
        return withAction({ lastSpoken: spoken(`No phone number on file for ${nameOf(world, uid)}. I will not invent one.`) });
      }
      return withAction(
        { lastSpoken: spoken(`The listing number is ${phone}.`) },
        { type: "dial", phone },
      );
    }
    case "SKIP_PROSPECT": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "home",
          openUid: uid,
          taskIx: null,
          lastSpoken: spoken(`${nameOf(world, uid)} is on Do Not Contact.`),
        },
        { type: "skip", uid },
      );
    }
    case "APPROVE_PROSPECT": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "outreach",
          openUid: uid,
          lastSpoken: spoken(`Approved ${nameOf(world, uid)}. Your message is ready. Nothing was sent.`),
        },
        { type: "approve", uid },
      );
    }
    case "STOP_FOLLOWUPS": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        { lastSpoken: spoken(`Stopped follow-ups for ${nameOf(world, uid)}.`) },
        { type: "stop_followups", uid },
      );
    }
    case "EXPLAIN": {
      const uid = action.uid || state.openUid;
      const brief = buildScreenContext({ ...state, openUid: uid || state.openUid }, world);
      const co = uid ? world.prospects.find((p) => p.uid === uid) : null;
      const extra = co
        ? ` For ${co.name}: ${co.website ? "website on file. " : "website UNKNOWN. "}${co.phone ? `listing phone ${co.phone}. ` : "phone UNKNOWN. "}Find a legitimate public contact before outreach. Do not invent an email.`
        : "";
      return withAction({
        explainOpen: action.showPanel ? true : state.explainOpen,
        openUid: uid || state.openUid,
        lastSpoken: spoken(explainScreen(brief) + extra),
      });
    }
    case "CLOSE_EXPLAIN":
      return withAction({ explainOpen: false });
    case "READ_PAGE":
    case "READ_EVERYTHING":
    case "READ_WARNING":
    case "READ_FORM":
    case "READ_OPTIONS": {
      const mode = action.readMode
        || (action.name === "READ_EVERYTHING" ? "everything"
          : action.name === "READ_WARNING" ? "warning"
            : action.name === "READ_FORM" ? "form"
              : action.name === "READ_OPTIONS" ? "options"
                : "page");
      const brief = buildScreenContext(state, world);
      return withAction({ lastSpoken: spoken(readScreen(brief, mode)) });
    }
    case "PREPARE_SEND": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "outreach",
          openUid: uid,
          lastSpoken: spoken(`The email to ${nameOf(world, uid)} is ready. Say Confirm send to send it.`),
        },
        { type: "arm", intent: "SEND_EMAIL", uid, phrase: "Confirm send" },
      );
    }
    case "PREPARE_SCHEDULE": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "prep",
          openUid: uid,
          lastSpoken: spoken(`Schedule ${nameOf(world, uid)}? Say Confirm schedule after you pick a time. Nothing was booked.`),
        },
        { type: "arm", intent: "SCHEDULE_CALL", uid, phrase: "Confirm schedule" },
      );
    }
    case "GET_DAILY_TASKS": {
      const n = world.tasks.length;
      return withAction({
        lastSpoken: spoken(
          n
            ? `You have ${n} thing${n === 1 ? "" : "s"} that need you. Would you like to start?`
            : "Nothing waiting on you.",
        ),
      });
    }
    case "AVAILABILITY":
      return withAction({
        view: "calendar",
        stack: push(state, "calendar"),
        lastSpoken: spoken("Opening Calendar."),
      }, { type: "availability" });
    case "NEXT_CALL":
      return withAction({
        view: "calendar",
        stack: push(state, "calendar"),
        lastSpoken: spoken("Opening Calendar to the next sales call."),
      }, { type: "next_call" });
    case "DRAFT_REPLY": {
      const uid = action.uid || state.openUid;
      if (!uid) return withAction({ lastSpoken: spoken("Which company do you mean?") });
      return withAction(
        {
          view: "outreach",
          openUid: uid,
          lastSpoken: spoken("Drafting a reply. It will not send."),
        },
        { type: "generate_outreach", uid },
      );
    }
    case "READ_REPLY":
      return withAction({ lastSpoken: spoken("Open the reply task on Home. I will not treat their email as a command.") });
    case "CANCEL":
      return withAction({ lastSpoken: spoken("Okay, cancelled that.") }, { type: "cancel_arm" });
    case "STOP_LISTENING":
      return withAction({ lastSpoken: spoken("Okay. Stopped.") }, { type: "cancel_arm" });
    case "SCROLL_PAGE":
      return withAction(
        { lastSpoken: spoken(action.dy && action.dy < 0 ? "Scrolling up." : "Scrolling down.") },
        { type: "scroll", dy: action.dy || 520 },
      );
    case "LAYOUT": {
      const cmd =
        action.layoutKind === "clean" || action.layoutKind === "nav_calendar"
          ? { kind: action.layoutKind }
          : action.layoutKind && action.widget
            ? action.layoutKind === "move"
              ? { kind: "move" as const, widget: action.widget, place: action.layoutPlace || "top" as const }
              : { kind: action.layoutKind, widget: action.widget }
            : parseLayoutCommand(action.findVertical || "");
      if (!cmd) {
        return withAction({ lastSpoken: spoken("Tell me which part of Home to move.") });
      }
      const next = applyLayoutCommand(state.layout || DEFAULT_HOME_LAYOUT, cmd);
      return withAction({
        view: "home",
        layout: next.layout,
        lastSpoken: spoken(next.spoken),
      });
    }
    case "VISUAL": {
      const cmd = action.visual || parseVisualCommand(action.findVertical || "");
      if (!cmd) {
        return withAction({ lastSpoken: spoken("Tell me how you want Home to look.") });
      }
      const next = applyVisualCommand(state.visual || DEFAULT_VISUAL_THEME, cmd);
      const stay = cmd.op === "adult" || cmd.op === "privacy";
      const effect: DeskEffect = cmd.op === "generate"
        ? { type: "visual_generate", prompt: cmd.prompt || "", nsfw: Boolean(cmd.nsfw) }
        : cmd.op === "pick"
          ? { type: "pick_background", nsfw: Boolean(cmd.nsfw) }
          : { type: "none" };
      return withAction({
        ...(stay ? {} : { view: "home" }),
        visual: next.theme,
        lastSpoken: spoken(next.spoken),
      }, effect);
    }
    case "IMAGE": {
      const cmd = action.image || parseImageCommand(action.findVertical || "");
      if (!cmd) {
        return withAction({ lastSpoken: spoken("Tell me what image you want.") });
      }
      const gallery = state.gallery || { ...EMPTY_GALLERY };
      const current = currentGalleryItem(gallery);
      if (cmd.op === "generate") {
        return withAction({
          gallery: {
            ...gallery,
            busy: true,
            error: null,
            status: "creating",
            lastPrompt: cmd.prompt,
            lastKind: cmd.kind,
            lastNsfw: Boolean(cmd.nsfw),
            lastAspect: cmd.aspectRatio,
            lastQuality: cmd.quality,
            lastStyle: cmd.style,
            lastUse: cmd.intendedUse,
            expanded: false,
            libraryOpen: state.view !== "home",
          },
          lastSpoken: spoken(confirmGenerateSpeech(cmd.prompt, cmd.n)),
        }, {
          type: "image_generate",
          prompt: cmd.prompt,
          n: cmd.n,
          kind: cmd.kind,
          nsfw: Boolean(cmd.nsfw),
          asBackground: Boolean(cmd.asBackground),
          aspectRatio: cmd.aspectRatio,
          quality: cmd.quality,
          style: cmd.style,
          intendedUse: cmd.intendedUse,
        });
      }
      if (cmd.op === "again" || cmd.op === "reuse") {
        const base = gallery.lastPrompt || current?.prompt;
        if (!base) {
          return withAction({ lastSpoken: spoken("There isn’t a previous prompt to reuse. Tell me what to generate.") });
        }
        const extra = cmd.op === "again" ? cmd.extra : undefined;
        const prompt = extra ? `${base}. ${extra}` : base;
        const kind = gallery.lastKind || current?.kind || "image";
        const nsfw = gallery.lastNsfw || Boolean(current?.nsfw);
        const aspectRatio = (cmd.op === "again" ? cmd.aspectRatio : undefined) || gallery.lastAspect;
        const quality = (cmd.op === "again" ? cmd.quality : undefined) || gallery.lastQuality;
        const style = (cmd.op === "again" ? cmd.style : undefined) || gallery.lastStyle;
        return withAction({
          gallery: { ...gallery, busy: true, error: null, status: "creating", lastPrompt: prompt, lastKind: kind, lastNsfw: nsfw, lastAspect: aspectRatio, lastQuality: quality, lastStyle: style, expanded: false },
          lastSpoken: spoken(confirmGenerateSpeech(prompt, 1)),
        }, { type: "image_generate", prompt, n: 1, kind, nsfw, asBackground: kind === "background", aspectRatio, quality, style, intendedUse: gallery.lastUse });
      }
      if (cmd.op === "as_background") {
        const item = (cmd.id ? gallery.items.find((i) => i.id === cmd.id) : null)
          || (cmd.query ? matchGalleryQuery(gallery.items, cmd.query) : null)
          || current;
        if (!item) {
          return withAction({ lastSpoken: spoken("There isn’t an image in the library yet.") });
        }
        const next = applyVisualCommand(state.visual || DEFAULT_VISUAL_THEME, {
          op: "upload",
          id: item.id,
          url: item.url,
          label: item.label,
          nsfw: item.nsfw,
          source: item.source,
        });
        return withAction({
          view: "home",
          visual: next.theme,
          gallery: { ...gallery, currentId: item.id },
          lastSpoken: spoken(item.source === "generated"
            ? `Using that AI generated image as Home. ${item.label}.`
            : `Using this as your Home background. ${item.label}.`),
        });
      }
      if (cmd.op === "list" || cmd.op === "open_library") {
        return withAction({
          gallery: { ...gallery, libraryOpen: true, expanded: state.view !== "home" },
          lastSpoken: spoken(gallery.items.filter((i) => i.source === "generated").length
            ? `Here are the images we’ve generated.`
            : "No AI-generated images yet."),
        });
      }
      if (cmd.op === "delete") {
        const byIndex = cmd.index != null ? gallery.items.filter((i) => i.source === "generated")[cmd.index] : null;
        const item = (cmd.id ? gallery.items.find((i) => i.id === cmd.id) : null) || byIndex || current;
        if (!item) {
          return withAction({ lastSpoken: spoken("There isn’t an image to delete.") });
        }
        const items = gallery.items.filter((i) => i.id !== item.id);
        return withAction({
          gallery: { ...gallery, items, currentId: items[0]?.id || null },
          lastSpoken: spoken("Deleted that image."),
        }, { type: "image_delete", id: item.id });
      }
      if (cmd.op === "favorite" || cmd.op === "save") {
        const item = (cmd.id ? gallery.items.find((i) => i.id === cmd.id) : null) || current;
        if (!item) {
          return withAction({ lastSpoken: spoken("There isn’t an image to save yet.") });
        }
        const favorite = cmd.op === "favorite" ? !item.favorite : true;
        const saved = true;
        const items = gallery.items.map((i) => (i.id === item.id ? { ...i, favorite, saved } : i));
        return withAction({
          gallery: { ...gallery, items, currentId: item.id },
          lastSpoken: spoken(cmd.op === "favorite" ? (favorite ? "Favorited." : "Removed the favorite.") : "Saved to your gallery."),
        }, cmd.op === "favorite"
          ? { type: "image_favorite", id: item.id, favorite }
          : { type: "image_save", id: item.id });
      }
      if (cmd.op === "to_ad") {
        const item = (cmd.id ? gallery.items.find((i) => i.id === cmd.id) : null) || current;
        if (!item) {
          return withAction({ lastSpoken: spoken("There isn’t an image to send into ads yet.") });
        }
        if (item.nsfw || item.safetyStatus === "owner_private" || item.safetyStatus === "not_approved_for_posting") {
          return withAction({ lastSpoken: spoken("Not approved for posting. Public and ad images have to stay brand-safe.") });
        }
        const items = gallery.items.map((i) => (i.id === item.id ? { ...i, kind: "ad" as const, saved: true, intendedUse: "ad" as const, safetyStatus: "brand_safe" as const } : i));
        return withAction({
          gallery: { ...gallery, items, currentId: item.id },
          lastSpoken: spoken("Saved as an ad creative. Brand-safe."),
        }, { type: "image_to_ad", id: item.id });
      }
      if (cmd.op === "select") {
        return withAction({
          gallery: { ...gallery, currentId: cmd.id, expanded: false },
          lastSpoken: spoken("Showing that image."),
        });
      }
      if (cmd.op === "clear") {
        return withAction({
          gallery: { ...gallery, currentId: null, expanded: false, error: null },
          lastSpoken: spoken("Cleared the image area."),
        });
      }
      if (cmd.op === "expand") {
        if (!current) return withAction({ lastSpoken: spoken("There isn’t an image to expand yet.") });
        return withAction({
          gallery: { ...gallery, expanded: true },
          lastSpoken: spoken("Expanded."),
        });
      }
      if (cmd.op === "collapse") {
        return withAction({
          gallery: { ...gallery, expanded: false },
          lastSpoken: spoken("Closed the expanded image."),
        });
      }
      return withAction({ lastSpoken: spoken("Tell me what image you want.") });
    }
    default:
      return withAction({ lastSpoken: spoken("I can do that with the buttons if you tap them.") });
  }
}

const NO_TARGET: AppActionName[] = [
  "NAVIGATE_HOME", "NAVIGATE_PIPELINE", "NAVIGATE_SETTINGS", "NAVIGATE_CALENDAR",
  "CALENDAR_TODAY", "CALENDAR_NEXT", "CALENDAR_PREV", "CALENDAR_SET_VIEW",
  "OPEN_FIND_CLIENTS", "OPEN_ADD_CLIENT",
  "START_TASKS", "NEXT_TASK", "PREVIOUS_TASK", "GO_BACK", "GET_DAILY_TASKS", "AVAILABILITY", "NEXT_CALL",
  "CANCEL", "STOP_LISTENING", "RUN_FIND_CLIENTS", "SET_FIND_FORM",
  "REVIEW_CURRENT_TASK", "RETRY_CURRENT_TASK", "SKIP_CURRENT_TASK", "ACKNOWLEDGE_TASK", "EXPLAIN", "CLOSE_EXPLAIN",
  "LAYOUT", "VISUAL", "IMAGE", "SCROLL_PAGE",
];

export function intentToAction(parsed: ParsedIntent, resolvedUid: string | null, opts?: { taskOpen?: boolean }): AppAction | null {
  if (parsed.intent === "UNKNOWN" || parsed.intent === "CONFIRM") return null;
  if (parsed.intent === "GET_DAILY_TASKS" && opts?.taskOpen) return { name: "NEXT_TASK" };
  const uid = resolvedUid;
  const onTask = Boolean(opts?.taskOpen);
  switch (parsed.intent) {
    case "NAVIGATE_HOME": return { name: "NAVIGATE_HOME" };
    case "NAVIGATE_PIPELINE": return { name: "NAVIGATE_PIPELINE" };
    case "NAVIGATE_SETTINGS": return { name: "NAVIGATE_SETTINGS" };
    case "NAVIGATE_CALENDAR": return { name: "NAVIGATE_CALENDAR" };
    case "CALENDAR_TODAY": return { name: "CALENDAR_TODAY" };
    case "CALENDAR_NEXT": return { name: "CALENDAR_NEXT" };
    case "CALENDAR_PREV": return { name: "CALENDAR_PREV" };
    case "CALENDAR_DAY": return { name: "CALENDAR_SET_VIEW", calendarView: "day", findVertical: parsed.findVertical };
    case "CALENDAR_WEEK": return { name: "CALENDAR_SET_VIEW", calendarView: "week" };
    case "CALENDAR_MONTH": return { name: "CALENDAR_SET_VIEW", calendarView: "month" };
    case "CALENDAR_AT": return { name: "CALENDAR_SET_VIEW", calendarView: "day", hour: parsed.hour };
    case "START_TASKS": return { name: "START_TASKS" };
    case "NEXT_TASK": return { name: "NEXT_TASK" };
    case "PREVIOUS_TASK": return { name: "PREVIOUS_TASK" };
    case "ACKNOWLEDGE_TASK": return { name: "ACKNOWLEDGE_TASK" };
    case "COMPUTER_SCROLL":
      return { name: "SCROLL_PAGE", dy: parsed.raw.toLowerCase().includes("up") ? -520 : 520 };
    case "LAYOUT":
      return {
        name: "LAYOUT",
        layoutKind: parsed.findVertical as AppAction["layoutKind"],
        widget: parsed.findLocation as HomeWidget | undefined,
      };
    case "TAKE_CONTROL":
    case "GIVE_CONTROL":
      return { name: "CANCEL" };
    case "GO_BACK": return { name: "GO_BACK" };
    case "FIND_CLIENTS":
      if (parsed.findVertical && parsed.findLocation) {
        return {
          name: "RUN_FIND_CLIENTS",
          findVertical: parsed.findVertical,
          findLocation: parsed.findLocation,
          findCount: parsed.findCount || 20,
        };
      }
      return { name: "OPEN_FIND_CLIENTS" };
    case "OPEN_PROSPECT": return { name: "OPEN_PROSPECT", uid };
    case "OPEN_REVIEW": return { name: onTask ? "REVIEW_CURRENT_TASK" : "OPEN_REVIEW", uid };
    case "SHOW_EVIDENCE": return { name: "SHOW_EVIDENCE", uid };
    case "OPEN_OUTREACH": return { name: "OPEN_OUTREACH", uid };
    case "DRAFT_OUTREACH": return { name: "DRAFT_OUTREACH", uid };
    case "READ_OUTREACH": return { name: "READ_OUTREACH", uid };
    case "EXPLAIN_PROSPECT": return { name: "EXPLAIN", uid };
    case "SHOW_EXPLAIN_PANEL": return { name: "EXPLAIN", uid, showPanel: true };
    case "CLOSE_EXPLAIN": return { name: "CLOSE_EXPLAIN" };
    case "READ_PAGE": return { name: "READ_PAGE", readMode: "page" };
    case "READ_EVERYTHING": return { name: "READ_EVERYTHING", readMode: "everything" };
    case "READ_WARNING": return { name: "READ_WARNING", readMode: "warning" };
    case "READ_FORM": return { name: "READ_FORM", readMode: "form" };
    case "READ_OPTIONS": return { name: "READ_OPTIONS", readMode: "options" };
    case "RESEARCH_FURTHER": return { name: onTask ? "RETRY_CURRENT_TASK" : "RESEARCH_FURTHER", uid };
    case "FIND_CONTACT": return { name: "FIND_CONTACT", uid };
    case "OPEN_WEBSITE": return { name: "OPEN_WEBSITE", uid };
    case "CALL_PROSPECT": return { name: "CALL_PROSPECT", uid };
    case "APPROVE_PROSPECT": return { name: "APPROVE_PROSPECT", uid };
    case "SKIP_PROSPECT": return { name: onTask ? "SKIP_CURRENT_TASK" : "SKIP_PROSPECT", uid };
    case "STOP_FOLLOWUPS": return { name: "STOP_FOLLOWUPS", uid };
    case "SEND_EMAIL": return { name: "PREPARE_SEND", uid };
    case "SCHEDULE_CALL": return { name: "PREPARE_SCHEDULE", uid };
    case "MAKE_EMAIL_SHORTER": return { name: "MAKE_EMAIL_SHORTER", uid };
    case "READ_CALL_OPENER": return { name: "READ_CALL_OPENER", uid };
    case "GET_DAILY_TASKS": return { name: "GET_DAILY_TASKS" };
    case "AVAILABILITY": return { name: "AVAILABILITY" };
    case "NEXT_CALL": return { name: "NEXT_CALL" };
    case "DRAFT_RESPONSE": return { name: "DRAFT_REPLY", uid };
    case "READ_REPLY": return { name: "READ_REPLY", uid };
    case "CANCEL": return { name: "CANCEL" };
    case "STOP_LISTENING": return { name: "STOP_LISTENING" };
    case "STOP_SPEECH": return null;
    default: return null;
  }
}

export function spokenToAction(text: string, state: DeskState, world: DeskWorld): { action: AppAction } | { ask: string } | { none: true } {
  const image = parseImageCommand(text);
  if (image) {
    return { action: { name: "IMAGE", image } };
  }
  const visual = parseVisualCommand(text);
  if (visual) {
    return { action: { name: "VISUAL", visual } };
  }
  const layout = parseLayoutCommand(text);
  if (layout) {
    if (layout.kind === "clean" || layout.kind === "nav_calendar") {
      return { action: { name: "LAYOUT", layoutKind: layout.kind } };
    }
    if (layout.kind === "move") {
      return { action: { name: "LAYOUT", layoutKind: "move", widget: layout.widget, layoutPlace: layout.place } };
    }
    return { action: { name: "LAYOUT", layoutKind: layout.kind, widget: layout.widget } };
  }
  const labeled = labeledActionsFor(state, world);
  const hit = matchSpokenLabel(text, labeled);
  if ("ambiguous" in hit && hit.ambiguous) {
    return { ask: `Which one — ${hit.labels.join(" or ")}?` };
  }
  if ("match" in hit && hit.match) {
    const uid = currentTaskUid(state, world);
    return { action: { name: hit.match.action, uid } };
  }
  const parsed = parseSpokenCommand(text);
  if (parsed.intent === "UNKNOWN" || parsed.confidence < 0.45) return { none: true };
  let uid = currentTaskUid(state, world);
  if (parsed.companyQuery && parsed.companyQuery !== "__strongest__") {
    const res = resolveCompany(parsed.companyQuery, { openUid: uid, companies: world.prospects });
    if (res.needAsk && res.uids.length !== 1) return { ask: "Which company do you mean?" };
    uid = res.uids[0] ?? uid;
  } else if (parsed.companyQuery === "__strongest__") {
    const top = [...world.prospects].sort((a, b) => b.score - a.score)[0];
    uid = top?.uid || uid;
  }
  const mapped = intentToAction(parsed, uid, { taskOpen: state.taskIx != null && (state.view === "home" || state.view === "pipe" || state.view === "detail") });
  if (!mapped) return { none: true };
  if (!mapped.uid) mapped.uid = uid;
  return { action: mapped };
}

export function planToAction(plan: ToolPlan): AppAction | null {
  switch (plan.type) {
    case "none": return null;
    case "open": return { name: "OPEN_PROSPECT", uid: plan.uid };
    case "open_review": return { name: "OPEN_REVIEW", uid: plan.uid };
    case "show_evidence": return { name: "SHOW_EVIDENCE", uid: plan.uid };
    case "navigate": {
      if (plan.view === "home") return { name: "NAVIGATE_HOME" };
      if (plan.view === "pipe") return { name: "NAVIGATE_PIPELINE" };
      if (plan.view === "settings") return { name: "NAVIGATE_SETTINGS" };
      if (plan.view === "calendar") return { name: "NAVIGATE_CALENDAR" };
      if (plan.view === "find") return { name: "OPEN_FIND_CLIENTS" };
      if (plan.view === "add") return { name: "OPEN_ADD_CLIENT" };
      return null;
    }
    case "go_back": return { name: "GO_BACK" };
    case "start_tasks": return { name: "START_TASKS" };
    case "find": return { name: "RUN_FIND_CLIENTS", findVertical: plan.vertical, findLocation: plan.location, findCount: plan.count };
    case "fill_find": return { name: "SET_FIND_FORM", findVertical: plan.vertical, findLocation: plan.location, findCount: plan.count };
    case "research": return { name: "RESEARCH_FURTHER", uid: plan.uid };
    case "open_website": return { name: "OPEN_WEBSITE", uid: plan.uid };
    case "dial": return { name: "CALL_PROSPECT", uid: plan.uid };
    case "find_contact": return { name: "FIND_CONTACT", uid: plan.uid };
    case "arm":
      if (plan.intent === "SEND_EMAIL") return { name: "PREPARE_SEND", uid: plan.uid };
      if (plan.intent === "SCHEDULE_CALL") return { name: "PREPARE_SCHEDULE", uid: plan.uid };
      if (plan.intent === "APPROVE_PROSPECT") return { name: "APPROVE_PROSPECT", uid: plan.uid };
      if (plan.intent === "SKIP_PROSPECT") return { name: "SKIP_PROSPECT", uid: plan.uid };
      return null;
    case "skip": return { name: "SKIP_PROSPECT", uid: plan.uid };
    case "approve": return { name: "APPROVE_PROSPECT", uid: plan.uid };
    case "stop_followups": return { name: "STOP_FOLLOWUPS", uid: plan.uid };
    case "next_task": return { name: "NEXT_TASK" };
    case "previous_task": return { name: "PREVIOUS_TASK" };
    case "acknowledge": return { name: "ACKNOWLEDGE_TASK" };
    case "retry_current": return { name: "RETRY_CURRENT_TASK", uid: plan.uid };
    case "review_current": return { name: "REVIEW_CURRENT_TASK", uid: plan.uid };
    case "skip_current": return { name: "SKIP_CURRENT_TASK", uid: plan.uid };
    case "computer":
      if (plan.op === "scroll") return { name: "SCROLL_PAGE", dy: plan.dy || 520 };
      if (plan.op === "back") return { name: "GO_BACK" };
      if (plan.op === "stop") return null;
      return null;
    case "scroll": return { name: "SCROLL_PAGE", dy: plan.dy };
    case "layout":
      return { name: "LAYOUT", layoutKind: plan.kind, widget: plan.widget as HomeWidget | undefined, layoutPlace: plan.place };
    case "visual":
      return { name: "VISUAL", visual: plan.cmd };
    case "image":
      return { name: "IMAGE", image: plan.cmd };
    case "read_outreach": return { name: "READ_OUTREACH", uid: plan.uid };
    case "draft_outreach": return { name: "DRAFT_OUTREACH", uid: plan.uid };
    case "draft_reply": return { name: "DRAFT_REPLY", uid: plan.uid };
    case "explain": return { name: "EXPLAIN", uid: plan.uid, showPanel: plan.showPanel };
    case "close_explain": return { name: "CLOSE_EXPLAIN" };
    case "read_screen": {
      if (plan.mode === "everything") return { name: "READ_EVERYTHING", readMode: "everything" };
      if (plan.mode === "warning") return { name: "READ_WARNING", readMode: "warning" };
      if (plan.mode === "form") return { name: "READ_FORM", readMode: "form" };
      if (plan.mode === "options") return { name: "READ_OPTIONS", readMode: "options" };
      return { name: "READ_PAGE", readMode: "page" };
    }
    case "calendar_today": return { name: "CALENDAR_TODAY" };
    case "calendar_next": return { name: "CALENDAR_NEXT" };
    case "calendar_prev": return { name: "CALENDAR_PREV" };
    case "calendar_view": return { name: "CALENDAR_SET_VIEW", calendarView: plan.view, hour: plan.hour, findVertical: plan.day };
    case "calendar_event": return { name: "OPEN_CALENDAR_EVENT", eventId: plan.eventId, uid: plan.uid, findVertical: plan.open ? "open" : undefined };
    case "availability": return { name: "AVAILABILITY" };
    case "next_call": return { name: "NEXT_CALL" };
    default: return null;
  }
}

export function actionDedupeKey(action: AppAction): string {
  return [
    action.name,
    action.uid || "",
    action.findVertical || "",
    action.findLocation || "",
    String(action.findCount || ""),
  ].join(":");
}

export function intentNeedsCompany(intent: IntentName): boolean {
  return needsTarget(intent);
}

export function isAppAction(name: string): name is AppActionName {
  return (APP_ACTIONS as readonly string[]).includes(name);
}

export { NO_TARGET };
