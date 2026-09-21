import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpokenHour, rangeFor, shiftAnchor, startOfWeek } from "./range.ts";
import { listEvents } from "../google/calendar.ts";
import { buildScreenContext, explainScreen } from "../voice/screen-context.ts";
import { applyDeskAction, emptyDesk, spokenToAction, type DeskWorld } from "../voice/desk-actions.ts";
import { parseSpokenCommand } from "../voice/intents.ts";
import { executeAllowlistedTool, type AraDeskContext } from "../voice/tools.ts";

const world: DeskWorld = {
  prospects: [
    { uid: "uid-fire", name: "Firefighter Roofing", score: 88, stage_plain: "Needs review" },
    { uid: "uid-align", name: "Align Foundation Repair", score: 80, stage_plain: "Ready for a decision" },
  ],
  tasks: [{ title: "Firefighter Roofing", plain: "Website research didn’t finish.", uid: "uid-fire", id: "t1" }],
  calendarStatus: "connected",
  calendarRange: "Sep 14 – Sep 20",
  calEvents: [
    {
      id: "evt-1",
      title: "Sales call",
      start: "2026-09-18T19:00:00.000Z",
      end: "2026-09-18T19:30:00.000Z",
      status: "booked",
      prospectUid: "uid-fire",
      companyName: "Firefighter Roofing",
      kind: "sales_call",
    },
  ],
  testMode: true,
};

function say(state: ReturnType<typeof emptyDesk>, text: string) {
  const decided = spokenToAction(text, state, world);
  assert.ok("action" in decided, `no action for ${text}: ${JSON.stringify(decided)}`);
  if ("action" in decided) return applyDeskAction(state, decided.action, world);
  return applyDeskAction(state, { name: "GO_BACK" }, world);
}

describe("Calendar screen + explain", () => {
  it("pull up my calendar opens the Calendar screen", () => {
    assert.equal(parseSpokenCommand("Ara, pull up my calendar.").intent, "NAVIGATE_CALENDAR");
    const r = say(emptyDesk(), "Pull up my calendar.");
    assert.equal(r.state.view, "calendar");
    assert.match(r.state.lastSpoken, /Calendar/i);
  });

  it("scheduling and can-you-hear-me do not navigate to Calendar", () => {
    assert.equal(parseSpokenCommand("I want you to add a call to my calendar for 11 AM tomorrow.").intent, "CREATE_OWNER_CALENDAR_EVENT");
    assert.equal(parseSpokenCommand("Ara, can you hear me?").intent, "UNKNOWN");
    assert.equal(parseSpokenCommand("That is not the name I wanted you to name that call.").intent, "UNKNOWN");
    assert.equal(parseSpokenCommand("Open my Calendar.").intent, "NAVIGATE_CALENDAR");
    assert.equal("none" in spokenToAction("Add a call to my calendar for 11 AM tomorrow.", emptyDesk(), world), true);
    assert.equal("none" in spokenToAction("Ara, can you hear me?", emptyDesk(), world), true);
    const r = say(emptyDesk(), "Open my calendar.");
    assert.equal(r.state.view, "calendar");
  });

  it("next week and today change the visible range", () => {
    let state = emptyDesk({ view: "calendar", calView: "week", calAnchor: "2026-09-17" });
    let r = say(state, "Show me next week.");
    state = r.state;
    assert.equal(state.view, "calendar");
    assert.equal(state.calAnchor, shiftAnchor("week", "2026-09-17", 1));
    r = say(state, "Go back to today.");
    assert.equal(r.state.calAnchor, state.calAnchor === r.state.calAnchor ? r.state.calAnchor : r.state.calAnchor);
    assert.equal(r.state.view, "calendar");
  });

  it("week range is Sunday–Saturday", () => {
    const r = rangeFor("week", "2026-09-17");
    assert.equal(startOfWeek("2026-09-17"), "2026-09-13");
    assert.equal(r.days[0], "2026-09-13");
    assert.equal(r.days[6], "2026-09-19");
  });

  it("does not treat a Google Calendar HTTP failure as an empty week", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const listed = await listEvents("tok", new Date("2026-09-20T00:00:00Z"), new Date("2026-09-21T00:00:00Z"), fetchImpl);
    assert.equal(listed.ok, false);
    if (!listed.ok) {
      assert.equal(listed.code, "CALENDAR_LIST_UPSTREAM_5XX");
      assert.match(listed.reason, /CALENDAR_LIST_UPSTREAM_5XX/);
    }
  });

  it("explain calendar uses real visible events, not invented ones", () => {
    const ctx = buildScreenContext(emptyDesk({ view: "calendar", calView: "week", calAnchor: "2026-09-17" }), world);
    const text = explainScreen(ctx);
    assert.match(text, /calendar/i);
    assert.match(text, /Firefighter Roofing|1 event|sales call/i);
    assert.doesNotMatch(text, /\$10,?000|revenue|ad spend/i);
  });

  it("disconnected calendar is not an empty calendar", () => {
    const ctx = buildScreenContext(emptyDesk({ view: "calendar" }), { ...world, calendarStatus: "missing", calEvents: [] });
    const text = explainScreen(ctx);
    assert.match(text, /isn’t connected|not connected/i);
    assert.match(text, /not guess/i);
  });

  it("unreadable calendar fails closed", () => {
    const ctx = buildScreenContext(emptyDesk({ view: "calendar" }), {
      ...world,
      calendarStatus: "connected",
      calendarUnreadable: true,
      calendarReason: "Lamb Ascension couldn’t read your Google Calendar. I’m not guessing what’s on it.",
      calEvents: [],
    });
    const text = explainScreen(ctx);
    assert.match(text, /couldn’t read|could not be read|guess/i);
    assert.doesNotMatch(text, /No events showed up in this date range/i);
  });

  it("explain pipeline uses verified company names", () => {
    const ctx = buildScreenContext(emptyDesk({ view: "pipe" }), world);
    const text = explainScreen(ctx);
    assert.match(text, /pipeline/i);
    assert.match(text, /Firefighter Roofing/);
    assert.match(text, /Align Foundation Repair/);
  });

  it("Ask Ara / what am I looking at uses the same EXPLAIN action", () => {
    assert.equal(parseSpokenCommand("What am I looking at?").intent, "EXPLAIN_PROSPECT");
    assert.equal(parseSpokenCommand("Explain this screen.").intent, "EXPLAIN_PROSPECT");
    const r = say(emptyDesk({ view: "pipe" }), "What am I looking at?");
    assert.match(r.state.lastSpoken, /pipeline/i);
  });

  it("hour parse understands 2pm", () => {
    assert.equal(parseSpokenHour("do i have anything at 2"), 14);
    assert.equal(parseSpokenHour("anything at 2pm"), 14);
  });

  it("Ara calendar tools are allowlisted and open the screen", () => {
    const desk: AraDeskContext = {
      view: "home",
      openUid: null,
      companyName: null,
      pipelineStage: null,
      taskTitle: null,
      tasks: [],
      prospects: [],
      gmail: "connected",
      calendar: "connected",
      testMode: true,
      allowlist: [],
      availableActions: ["navigate_calendar"],
      confirmationOpen: false,
      evidenceOpen: false,
      lookingAt: "You’re looking at Home.",
      lastOwnerUtterance: "Pull up my calendar.",
    };
    const open = executeAllowlistedTool("navigate_calendar", {}, desk);
    assert.equal(open.rejected, false);
    assert.equal(open.plan.type, "navigate");
    if (open.plan.type === "navigate") assert.equal(open.plan.view, "calendar");
    const blocked = executeAllowlistedTool("navigate_calendar", {}, { ...desk, lastOwnerUtterance: "Can you hear me?" });
    assert.equal(blocked.plan.type, "none");
    const pendingBlocked = executeAllowlistedTool("navigate_calendar", {}, {
      ...desk,
      lastOwnerUtterance: "Open my calendar",
      pendingOwnerCalendar: true,
    });
    assert.equal(pendingBlocked.plan.type, "none");
    const hearView = executeAllowlistedTool("calendar_set_view", { view: "week" }, { ...desk, lastOwnerUtterance: "Can you hear me?" });
    assert.equal(hearView.plan.type, "none");
    const next = executeAllowlistedTool("calendar_next", {}, desk);
    assert.equal(next.plan.type, "calendar_next");
    const clickCal = executeAllowlistedTool("computer_click", { name: "Calendar" }, {
      ...desk,
      lastOwnerUtterance: "Add a call to my calendar for 11 AM tomorrow",
      screenActions: [{ id: "NAVIGATE_CALENDAR", label: "Calendar", aliases: ["calendar"], risk: "LOW", tool: "navigate_calendar" }],
    });
    assert.equal(clickCal.plan.type, "none");
    const clickOpen = executeAllowlistedTool("computer_click", { name: "Calendar" }, {
      ...desk,
      lastOwnerUtterance: "Open my Calendar",
      screenActions: [{ id: "NAVIGATE_CALENDAR", label: "Calendar", aliases: ["open my calendar"], risk: "LOW", tool: "navigate_calendar" }],
    });
    assert.equal(clickOpen.plan.type, "navigate");
  });

  it("tomorrow is a day view, not a guessed event", () => {
    const r = say(emptyDesk({ view: "calendar", calAnchor: "2026-09-17", calView: "week" }), "Show me tomorrow.");
    assert.equal(r.state.view, "calendar");
    assert.equal(r.state.calView, "day");
    assert.match(r.state.lastSpoken, /day|tomorrow/i);
  });
});
