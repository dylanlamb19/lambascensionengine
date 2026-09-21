import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpokenCommand, resolveCompany, stripWake } from "./intents.ts";
import {
  actionDedupeKey,
  applyDeskAction,
  emptyDesk,
  intentToAction,
  planToAction,
  screenContext,
  spokenToAction,
  type DeskState,
  type DeskWorld,
} from "./desk-actions.ts";
import { labeledActionsFor } from "./screen-actions.ts";
import { ActionGate } from "./idempotency.ts";
import { executeAllowlistedTool, type AraDeskContext } from "./tools.ts";

const world: DeskWorld = {
  prospects: [
    { uid: "uid-fire", name: "Firefighter Roofing", score: 88, stage_plain: "New", website: "https://firefighterroofing.com/", phone: "(817) 479-8999" },
    { uid: "uid-saas", name: "Northstar SaaS", score: 70, stage_plain: "New" },
  ],
  tasks: [
    { title: "Firefighter Roofing needs a contact", plain: "Website research didn’t finish.", uid: "uid-fire", id: "fail-uid-fire", retry: true },
    { title: "Your email is ready", plain: "Preview then approve.", uid: "uid-saas", id: "out-uid-saas", retry: false },
  ],
};

function run(state: DeskState, spoken: string, openUid = state.openUid) {
  const decided = spokenToAction(spoken, { ...state, openUid }, world);
  if ("ask" in decided) {
    return { state: { ...state, lastSpoken: decided.ask }, effect: { type: "none" as const }, ask: decided.ask };
  }
  assert.ok(!("none" in decided), `no action for: ${spoken}`);
  if ("action" in decided) return applyDeskAction(state, decided.action, world);
  assert.fail(`no action for: ${spoken}`);
  return applyDeskAction(state, { name: "GO_BACK" }, world);
}

describe("Ara operates Owner Mode via allowlisted actions", () => {
  it("strips the Ara wake word", () => {
    assert.equal(stripWake("Ara, go to Pipeline."), "go to Pipeline.");
    assert.equal(parseSpokenCommand("Ara, go to Pipeline.").intent, "NAVIGATE_PIPELINE");
    assert.equal(parseSpokenCommand("Go home.").intent, "NAVIGATE_HOME");
    assert.equal(parseSpokenCommand("Take me home.").intent, "NAVIGATE_HOME");
  });

  it("hands-free sequence navigates without a mouse", () => {
    let state = emptyDesk();
    let r = run(state, "Ara, go to Pipeline.");
    state = r.state;
    assert.equal(state.view, "pipe");
    assert.match(state.lastSpoken, /Pipeline/i);

    r = run(state, "Open Firefighter Roofing.");
    state = r.state;
    assert.equal(state.view, "detail");
    assert.equal(state.openUid, "uid-fire");
    assert.equal(state.evidence, false);
    assert.match(state.lastSpoken, /Firefighter Roofing/);

    r = run(state, "Show me the evidence.");
    state = r.state;
    assert.equal(state.view, "detail");
    assert.equal(state.evidence, true);
    assert.equal(state.openUid, "uid-fire");

    r = run(state, "Go back.");
    state = r.state;
    assert.equal(state.evidence, false);
    assert.equal(state.view, "detail");
    assert.equal(state.openUid, "uid-fire");

    r = run(state, "Start my tasks.");
    state = r.state;
    assert.equal(state.taskIx, 0);
    assert.match(state.lastSpoken, /Firefighter Roofing/);

    r = run(state, "Next.");
    state = r.state;
    assert.equal(state.taskIx, 1);
    assert.match(state.lastSpoken, /email is ready/i);

    r = run(state, "Find me 20 roofing companies in Fort Worth.");
    state = r.state;
    assert.equal(state.view, "find");
    assert.equal(state.findLimit, 20);
    assert.match(state.city, /Fort Worth/i);
    assert.equal(r.effect.type, "run_find");
    if (r.effect.type === "run_find") {
      assert.equal(r.effect.count, 20);
      assert.match(r.effect.location, /Fort Worth/i);
      assert.match(r.effect.vertical, /roofing/i);
    }

    r = run(state, "Take me home.");
    state = r.state;
    assert.equal(state.view, "home");
  });

  it("look for 20 med spas in Dallas fills the Find Clients form", () => {
    const parsed = parseSpokenCommand("Look for 20 med spas in Dallas");
    assert.equal(parsed.intent, "FIND_CLIENTS");
    assert.equal(parsed.findCount, 20);
    assert.match(parsed.findVertical || "", /med spas/i);
    assert.match(parsed.findLocation || "", /dallas/i);
    const action = intentToAction(parsed, null);
    assert.equal(action?.name, "RUN_FIND_CLIENTS");
    const r = applyDeskAction(emptyDesk(), action!, world);
    assert.equal(r.state.view, "find");
    assert.equal(r.state.findLimit, 20);
    assert.equal(r.state.city, "Dallas");
    assert.equal(r.state.vert, "Med spa / cosmetic");
  });

  it("review this one and skip use the current prospect UID", () => {
    const state = emptyDesk({ view: "detail", openUid: "uid-fire" });
    const review = run(state, "Review this one.");
    assert.equal(review.state.view, "detail");
    assert.equal(review.state.openUid, "uid-fire");
    const skip = run(state, "Skip this company.");
    assert.equal(skip.effect.type, "skip");
    if (skip.effect.type === "skip") assert.equal(skip.effect.uid, "uid-fire");
    assert.equal(skip.state.view, "home");
  });

  it("send still only prepares — Confirm send is required", () => {
    const state = emptyDesk({ view: "outreach", openUid: "uid-fire" });
    const r = run(state, "Send that email.");
    assert.equal(r.effect.type, "arm");
    if (r.effect.type === "arm") {
      assert.equal(r.effect.intent, "SEND_EMAIL");
      assert.equal(r.effect.phrase, "Confirm send");
    }
    assert.match(r.state.lastSpoken, /Confirm send/);
  });

  it("ambiguous company names ask instead of guessing", () => {
    const ctx = {
      openUid: null as string | null,
      companies: [
        { uid: "a", name: "Align Foundation Repair" },
        { uid: "b", name: "Align Dental" },
      ],
    };
    const res = resolveCompany("align", ctx);
    assert.equal(res.needAsk, true);
  });

  it("screen context lists available actions for the current view", () => {
    const state = emptyDesk({ view: "detail", openUid: "uid-fire" });
    const ctx = screenContext(state, world, { testMode: true, confirmationOpen: false });
    assert.equal(ctx.companyName, "Firefighter Roofing");
    assert.ok(ctx.availableActions.includes("show_evidence"));
    assert.ok(ctx.availableActions.includes("skip_prospect"));
    assert.equal(ctx.testMode, true);
  });

  it("Ara tools and spoken commands produce the same pipeline navigation action", () => {
    const spoken = intentToAction(parseSpokenCommand("Open Pipeline"), null);
    const tool = executeAllowlistedTool("navigate_pipeline", {}, {
      view: "home",
      openUid: null,
      companyName: null,
      taskTitle: null,
      tasks: [],
      prospects: [],
      gmail: "connected",
      calendar: "connected",
      testMode: true,
      allowlist: [],
      availableActions: [],
      confirmationOpen: false,
      evidenceOpen: false,
      pipelineStage: null,
    } satisfies AraDeskContext);
    assert.equal(spoken?.name, "NAVIGATE_PIPELINE");
    assert.equal(tool.plan.type, "navigate");
    if (tool.plan.type === "navigate") assert.equal(tool.plan.view, "pipe");
    const fromPlan = planToAction(tool.plan);
    assert.equal(fromPlan?.name, "NAVIGATE_PIPELINE");
  });

  it("duplicate Find Clients from transcript + tool spends once", () => {
    const g = new ActionGate();
    const action = intentToAction(parseSpokenCommand("Find me 20 roofing companies in Fort Worth"), null);
    assert.ok(action);
    const key = actionDedupeKey(action!);
    assert.equal(g.seen(key, 1800), false);
    assert.equal(g.seen(key, 1800), true);
  });

  it("click / eval / confirm_send tools stay forbidden", () => {
    const desk: AraDeskContext = {
      view: "home", openUid: "uid-fire", companyName: "Firefighter Roofing", taskTitle: null,
      tasks: [], prospects: [{ uid: "uid-fire", name: "Firefighter Roofing", stage: "New" }],
      gmail: "connected", calendar: "connected", testMode: true, allowlist: [],
      availableActions: [], confirmationOpen: false, evidenceOpen: false, pipelineStage: null,
    };
    assert.equal(executeAllowlistedTool("click", { selector: "#pipeline" }, desk).rejected, true);
    assert.equal(executeAllowlistedTool("run_javascript", { code: "1" }, desk).rejected, true);
    assert.equal(executeAllowlistedTool("confirm_send", { uid: "uid-fire" }, desk).rejected, true);
  });

  it("hands-free task buttons work after Start my tasks", () => {
    let state = emptyDesk();
    let r = run(state, "Start my tasks.");
    state = r.state;
    assert.equal(state.view, "home");
    assert.equal(state.taskIx, 0);
    assert.equal(state.openUid, "uid-fire");
    let ctx = screenContext(state, world);
    assert.equal(ctx.screen, "TASKS");
    assert.ok(ctx.availableActions.includes("review_current_task"));
    assert.ok(ctx.availableActions.includes("retry_current_task"));
    assert.ok(ctx.screenActions?.some((a) => a.label === "Learn More"));

    r = run(state, "Press Review.");
    state = r.state;
    assert.equal(state.view, "detail");
    assert.equal(state.openUid, "uid-fire");
    assert.equal(state.taskIx, 0);
    ctx = screenContext(state, world);
    assert.equal(ctx.screen, "REVIEW");
    assert.ok(ctx.availableActions.includes("show_evidence"));
    assert.equal(ctx.availableActions.includes("review_current_task"), false);

    r = run(state, "Show me the evidence.");
    state = r.state;
    assert.equal(state.evidence, true);

    r = run(state, "Go back.");
    state = r.state;
    assert.equal(state.view, "home");
    assert.equal(state.taskIx, 0);
    assert.equal(state.evidence, false);
    ctx = screenContext(state, world);
    assert.equal(ctx.screen, "TASKS");

    r = run(state, "Try again.");
    state = r.state;
    assert.equal(r.effect.type, "research");
    if (r.effect.type === "research") assert.equal(r.effect.uid, "uid-fire");

    r = run(state, "Next.");
    state = r.state;
    assert.equal(state.taskIx, 1);
    assert.equal(state.openUid, "uid-saas");
    assert.equal(state.view, "home");

    r = run(state, "Skip this one.");
    state = r.state;
    assert.equal(r.effect.type, "skip");
    if (r.effect.type === "skip") assert.equal(r.effect.uid, "uid-saas");

    r = run(state, "Go home.");
    state = r.state;
    assert.equal(state.view, "home");
  });

  it("Ara review_current_task tool uses the same action as the Review button", () => {
    const state = emptyDesk({ view: "home", taskIx: 0, openUid: "uid-fire" });
    const spoken = spokenToAction("Press Review.", state, world);
    assert.ok("action" in spoken);
    if ("action" in spoken) assert.equal(spoken.action.name, "REVIEW_CURRENT_TASK");
    const desk: AraDeskContext = {
      view: "home",
      openUid: "uid-fire",
      companyName: "Firefighter Roofing",
      taskTitle: "Firefighter Roofing",
      tasks: world.tasks,
      prospects: world.prospects.map((p) => ({ uid: p.uid, name: p.name, stage: "New" })),
      gmail: "connected",
      calendar: "connected",
      testMode: true,
      allowlist: [],
      availableActions: ["review_current_task"],
      confirmationOpen: true,
      evidenceOpen: false,
      pipelineStage: null,
      taskUid: "uid-fire",
      taskId: "fail-uid-fire",
      screen: "TASKS",
    };
    const tool = executeAllowlistedTool("review_current_task", {}, desk);
    assert.equal(tool.rejected, false);
    assert.equal(tool.plan.type, "review_current");
    if (tool.plan.type === "review_current") assert.equal(tool.plan.uid, "uid-fire");
    const fromPlan = planToAction(tool.plan);
    assert.equal(fromPlan?.name, "REVIEW_CURRENT_TASK");
    assert.equal(fromPlan?.uid, "uid-fire");
    const manual = applyDeskAction(state, { name: "REVIEW_CURRENT_TASK", uid: "uid-fire" }, world);
    const viaTool = applyDeskAction(state, fromPlan!, world);
    assert.equal(manual.state.view, viaTool.state.view);
    assert.equal(manual.state.openUid, viaTool.state.openUid);
  });

  it("ambiguous button labels ask instead of guessing", () => {
    const actions = labeledActionsFor(emptyDesk({ view: "detail", openUid: "uid-fire" }), world);
    assert.ok(actions.length > 1);
  });

  it("high-risk send still cannot be bypassed from a task screen", () => {
    const state = emptyDesk({ view: "home", taskIx: 0, openUid: "uid-fire" });
    const r = run(state, "Send that email.");
    assert.equal(r.effect.type, "arm");
    if (r.effect.type === "arm") assert.equal(r.effect.phrase, "Confirm send");
  });

  it("verbal explain speaks without opening a panel", () => {
    const looking = run(emptyDesk(), "What am I looking at?");
    assert.equal(looking.state.explainOpen, false);
    assert.match(looking.state.lastSpoken, /Home|looking/i);

    const explain = run(emptyDesk(), "Ara, explain this.");
    assert.equal(explain.state.explainOpen, false);
    assert.match(explain.state.lastSpoken, /Home|looking/i);

    const tool = executeAllowlistedTool("explain_current_screen", {}, {
      view: "home",
      openUid: null,
      companyName: null,
      pipelineStage: null,
      taskTitle: null,
      tasks: [],
      prospects: world.prospects.map((p) => ({ uid: p.uid, name: p.name, stage: "New" })),
      gmail: "connected",
      calendar: "connected",
      testMode: true,
      allowlist: [],
      availableActions: ["explain_current_screen"],
      confirmationOpen: false,
      evidenceOpen: false,
      lookingAt: "You’re looking at Home.",
      screen: "HOME",
    });
    assert.equal(tool.ok, true);
    assert.equal(tool.output.panel, false);
    assert.equal(tool.output.dimmed, false);
    const action = planToAction(tool.plan);
    assert.equal(action?.name, "EXPLAIN");
    assert.equal(action?.showPanel, false);
    const applied = applyDeskAction(emptyDesk(), action!, world);
    assert.equal(applied.state.explainOpen, false);
  });

  it("Explain this button and show me open a panel that does not survive navigation", () => {
    const opened = applyDeskAction(emptyDesk(), { name: "EXPLAIN", showPanel: true }, world);
    assert.equal(opened.state.explainOpen, true);
    assert.match(opened.state.lastSpoken, /Home|looking/i);

    const shown = run(emptyDesk(), "Show me that.");
    assert.equal(shown.state.explainOpen, true);

    const evidence = run(emptyDesk({ view: "detail", openUid: "uid-fire" }), "Show me the evidence.");
    assert.equal(evidence.state.evidence, true);
    assert.equal(evidence.state.explainOpen, false);

    const closed = applyDeskAction(opened.state, { name: "CLOSE_EXPLAIN" }, world);
    assert.equal(closed.state.explainOpen, false);
    assert.equal(closed.state.view, "home");

    const nav = applyDeskAction(opened.state, { name: "NAVIGATE_PIPELINE" }, world);
    assert.equal(nav.state.explainOpen, false);
    assert.equal(nav.state.view, "pipe");

    const prospect = applyDeskAction(opened.state, { name: "OPEN_PROSPECT", uid: "uid-fire" }, world);
    assert.equal(prospect.state.explainOpen, false);
    assert.equal(prospect.state.view, "detail");
    assert.equal(prospect.state.openUid, "uid-fire");

    const home = applyDeskAction(
      { ...opened.state, view: "pipe", explainOpen: true },
      { name: "NAVIGATE_HOME" },
      world,
    );
    assert.equal(home.state.explainOpen, false);
    assert.equal(home.state.view, "home");
  });

  it("clicking Explain this opens the panel, unlike a spoken question", () => {
    const actions = labeledActionsFor(emptyDesk(), world);
    const hit = actions.find((a) => a.label === "Explain this");
    assert.ok(hit);
    const click = executeAllowlistedTool("computer_click", { name: "Explain this" }, {
      view: "home",
      openUid: null,
      companyName: null,
      pipelineStage: null,
      taskTitle: null,
      tasks: [],
      prospects: world.prospects.map((p) => ({ uid: p.uid, name: p.name, stage: "New" })),
      gmail: "connected",
      calendar: "connected",
      testMode: true,
      allowlist: [],
      availableActions: ["explain_current_screen"],
      confirmationOpen: false,
      evidenceOpen: false,
      lookingAt: "You’re looking at Home.",
      screen: "HOME",
      screenActions: actions.map((a) => ({ id: a.id, label: a.label, aliases: a.aliases, risk: a.risk, tool: a.tool })),
    });
    assert.equal(click.ok, true);
    assert.equal(click.output.panel, true);
    const action = planToAction(click.plan);
    assert.equal(action?.showPanel, true);
    const applied = applyDeskAction(emptyDesk(), action!, world);
    assert.equal(applied.state.explainOpen, true);
  });

  it("Ara visual tools change Home theme without opening Explain This", () => {
    const mountain = spokenToAction("Put a relaxing mountain lake behind Home.", emptyDesk(), world);
    assert.ok("action" in mountain);
    if ("action" in mountain) {
      assert.equal(mountain.action.name, "VISUAL");
      const r = applyDeskAction(emptyDesk(), mountain.action, world);
      assert.equal(r.state.visual.home.backgroundId, "mountain-lake-sunrise");
      assert.equal(r.state.explainOpen, false);
      assert.equal(r.state.view, "home");
      const darker = spokenToAction("Make it darker.", r.state, world);
      assert.ok("action" in darker);
      if ("action" in darker) {
        const d = applyDeskAction(r.state, darker.action, world);
        assert.ok(d.state.visual.home.overlay > r.state.visual.home.overlay);
      }
      const glass = spokenToAction("Make the cards more glassy.", r.state, world);
      assert.ok("action" in glass);
      if ("action" in glass) {
        const g = applyDeskAction(r.state, glass.action, world);
        assert.equal(g.state.visual.home.cardGlass, true);
      }
      assert.equal(r.state.visual.home.blur, 0);
    }
    const nsfw = spokenToAction("Use an adult NSFW background.", emptyDesk(), world);
    assert.ok("action" in nsfw);
    if ("action" in nsfw) {
      const n = applyDeskAction(emptyDesk(), nsfw.action, world);
      assert.equal(n.state.visual.adultMode, true);
      assert.equal(n.state.visual.home.nsfw, true);
      assert.equal(n.state.visual.home.blur, 0);
      const again = spokenToAction("Try another one.", n.state, world);
      assert.ok("action" in again);
      if ("action" in again) {
        const a = applyDeskAction(n.state, again.action, world);
        assert.equal(a.state.visual.home.nsfw, true);
        assert.notEqual(a.state.visual.home.backgroundId, n.state.visual.home.backgroundId);
      }
      const mountain = spokenToAction("Go back to the mountain.", n.state, world);
      assert.ok("action" in mountain);
      if ("action" in mountain) {
        const m = applyDeskAction(n.state, mountain.action, world);
        assert.equal(m.state.visual.home.backgroundId, "mountain-lake-sunrise");
        assert.equal(m.state.visual.home.blur, 0);
      }
    }
    const tool = executeAllowlistedTool("set_page_background", { description: "relaxing mountain lake" }, {
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
      availableActions: [],
      confirmationOpen: false,
      evidenceOpen: false,
    });
    assert.equal(tool.ok, true);
    assert.equal(tool.plan.type, "visual");
    const fromPlan = planToAction(tool.plan);
    assert.equal(fromPlan?.name, "VISUAL");
    const looking = spokenToAction("What am I looking at?", emptyDesk(), world);
    assert.ok("action" in looking);
    if ("action" in looking) assert.equal(looking.action.name, "EXPLAIN");
  });

  it("Firefighter Roofing is not a dead end — Find Contact / Open Website / Call", () => {
    const home = emptyDesk({ view: "home", openUid: "uid-fire" });
    const labels = labeledActionsFor(home, world).map((a) => a.label);
    assert.ok(labels.includes("Learn More"));
    assert.ok(labels.includes("Find Contact"));
    assert.ok(labels.includes("Open Website"));
    assert.ok(labels.includes("Call"));

    const find = run(home, "Find the owner.");
    assert.equal(find.effect.type, "research");
    if (find.effect.type === "research") assert.equal(find.effect.uid, "uid-fire");
    assert.match(find.state.lastSpoken, /decision maker|owner/i);

    const site = run(home, "Open their website.");
    assert.equal(site.effect.type, "open_url");
    if (site.effect.type === "open_url") assert.match(site.effect.url, /firefighterroofing\.com/);

    const call = run(home, "Call them.");
    assert.equal(call.effect.type, "dial");
    if (call.effect.type === "dial") assert.match(call.effect.phone, /817/);

    const more = run(home, "Tell me more about them.");
    assert.equal(more.state.view, "detail");
    assert.equal(more.state.openUid, "uid-fire");

    const advise = run(home, "What should I do with Firefighter Roofing?");
    assert.match(advise.state.lastSpoken, /Firefighter Roofing/i);
    assert.match(advise.state.lastSpoken, /contact|website|phone/i);
  });

  it("does not invent a website or phone when none is on file", () => {
    const state = emptyDesk({ view: "detail", openUid: "uid-saas" });
    const site = applyDeskAction(state, { name: "OPEN_WEBSITE", uid: "uid-saas" }, world);
    assert.equal(site.effect.type, "none");
    assert.match(site.state.lastSpoken, /no verified website/i);
    const call = applyDeskAction(state, { name: "CALL_PROSPECT", uid: "uid-saas" }, world);
    assert.equal(call.effect.type, "none");
    assert.match(call.state.lastSpoken, /no phone/i);
  });

  it("read this page uses exact screen content, including Find Clients blocker", () => {
    const page = run(emptyDesk({ view: "find" }), "Read this page.");
    assert.match(page.state.lastSpoken, /Find Clients/i);
    const blocked = applyDeskAction(
      emptyDesk({ view: "find" }),
      { name: "READ_PAGE", readMode: "page" },
      { ...world, discoveryConfigured: false },
    );
    assert.match(blocked.state.lastSpoken, /Google Places is not configured/i);
    const tool = executeAllowlistedTool("read_current_screen", {}, {
      view: "settings",
      openUid: null,
      companyName: null,
      pipelineStage: null,
      taskTitle: null,
      tasks: [],
      prospects: [],
      gmail: "missing",
      calendar: "missing",
      testMode: true,
      allowlist: [],
      availableActions: ["read_current_screen"],
      confirmationOpen: false,
      evidenceOpen: false,
      lookingAt: "You’re in Settings.",
      important: "Google isn’t configured yet. The OAuth Client ID, Client Secret, APP_SECRET, and outreach job secret are missing, so Gmail and Calendar can’t connect yet.",
      nextFocus: "Connect anything that’s missing.",
      screen: "SETTINGS",
      screenFacts: [{ kind: "ERROR", text: "Gmail isn’t connected." }],
    });
    assert.equal(tool.ok, true);
    assert.equal(tool.output.already_spoken, true);
    assert.match(String(tool.output.spoken), /Google isn’t configured yet/);
  });
});

describe("Ara filters the Pipeline view without rediscovery", () => {
  const lastWorld: DeskWorld = {
    ...world,
    lastDiscovery: {
      query: "Roofing in Fort Worth, Texas",
      vertical: "Roofing",
      location: "Fort Worth, Texas",
      requested: 5,
      matched: 2,
      prospectUids: ["uid-fire", "uid-saas"],
      placeIds: ["ChFire", "ChSaas"],
      timestamp: "2026-09-20T12:00:00.000Z",
    },
    prospects: [
      {
        uid: "uid-fire",
        name: "Firefighter Roofing",
        score: 88,
        vertical: "Roofing",
        city: "Fort Worth",
        fitHeadline: "GOOD FIT",
        research: "not_started",
        reach: "NEEDS_CONTACT_INFO",
        hasPhone: true,
        hasWebsite: true,
        source: "google_places",
      },
      {
        uid: "uid-saas",
        name: "Northstar SaaS",
        score: 70,
        vertical: "SaaS / software",
        city: "Dallas",
        fitHeadline: "POSSIBLE FIT",
        research: "done",
        reach: "READY_TO_CONTACT",
        hasPhone: false,
        hasWebsite: true,
        source: "google_places",
      },
    ],
  };

  it("show me the five you just matched filters last discovery and does not run Find Clients", () => {
    const decided = spokenToAction("Show me the five roofing companies you just matched in Fort Worth.", emptyDesk(), lastWorld);
    assert.ok("action" in decided);
    if (!("action" in decided)) return;
    assert.equal(decided.action.name, "FILTER_PROSPECTS");
    assert.equal(decided.action.filter?.lastDiscovery, true);
    const applied = applyDeskAction(emptyDesk(), decided.action, lastWorld);
    assert.equal(applied.effect.type, "none");
    assert.equal(applied.state.view, "pipe");
    assert.equal(applied.state.prospectFilter.lastDiscovery, true);
    assert.match(applied.state.lastSpoken, /Firefighter Roofing|2|last search|Fort Worth/i);
    assert.doesNotMatch(applied.state.lastSpoken, /already on your list/i);
  });

  it("find me 5 roofing still discovers, not filters", () => {
    const parsed = parseSpokenCommand("Find me 5 roofing companies in Fort Worth.");
    assert.equal(parsed.intent, "FIND_CLIENTS");
  });

  it("clear filters is view-only", () => {
    const start = applyDeskAction(
      emptyDesk({ prospectFilter: { lastDiscovery: true } }),
      { name: "FILTER_PROSPECTS", filter: { lastDiscovery: true } },
      lastWorld,
    );
    const cleared = applyDeskAction(start.state, { name: "FILTER_PROSPECTS", filter: { replace: true } }, lastWorld);
    assert.equal(cleared.effect.type, "none");
    assert.deepEqual(cleared.state.prospectFilter, {});
    assert.match(cleared.state.lastSpoken, /cleared/i);
  });
});
