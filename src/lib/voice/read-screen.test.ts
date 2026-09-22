import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoAnnounceFromScreen, findClientsBlockerSpeech, readScreen, settingsBlockerSpeech } from "./read-screen.ts";
import type { CurrentScreenContext } from "./screen-context.ts";

const settings: CurrentScreenContext = {
  route: "settings",
  screen: "SETTINGS",
  purpose: "Settings",
  selectedUid: null,
  selectedName: null,
  currentTask: null,
  evidenceOpen: false,
  testMode: true,
  facts: [
    { kind: "ERROR", text: "Google OAuth Client ID is missing." },
    { kind: "ERROR", text: "Google OAuth Client Secret is missing." },
    { kind: "ERROR", text: "APP_SECRET is missing." },
    { kind: "ERROR", text: "OUTREACH_JOB_SECRET is missing." },
    { kind: "ERROR", text: "Gmail isn’t connected." },
    { kind: "ERROR", text: "Google Calendar isn’t connected." },
  ],
  lookingAt: "You’re in Settings.",
  important: "Google isn’t configured yet. The OAuth Client ID, Client Secret, APP_SECRET, and outreach job secret are missing, so Gmail and Calendar can’t connect yet.",
  next: "Connect anything that’s missing.",
  availableActions: ["navigate_home"],
  screenActions: [{ id: "HOME", label: "Home", aliases: ["home"], risk: "LOW", tool: "navigate_home" }],
};

describe("screen reading", () => {
  it("Settings read uses the configuration blocker, not decorative chrome", () => {
    const page = readScreen(settings, "page");
    assert.match(page, /Google isn’t configured yet/i);
    assert.match(page, /Gmail and Calendar/i);
    assert.doesNotMatch(page, /la-card|background|overlay/i);
    const warning = readScreen(settings, "warning");
    assert.match(warning, /OAuth Client ID/);
    const auto = autoAnnounceFromScreen(settings);
    assert.ok(auto);
    assert.equal(auto?.type, "BLOCKER");
    assert.match(auto?.text || "", /Google isn’t configured yet/);
  });

  it("read everything includes options", () => {
    const all = readScreen(settings, "everything");
    assert.match(all, /you can: Home/i);
  });

  it("settingsBlockerSpeech is natural", () => {
    const spoken = settingsBlockerSpeech([
      "OAuth Client ID",
      "Client Secret",
      "APP_SECRET",
      "outreach job secret",
    ]);
    assert.match(spoken, /Google isn’t configured yet/);
    assert.match(spoken, /can’t connect yet/);
  });

  it("Find Clients blocker is a single sentence", () => {
    assert.equal(
      findClientsBlockerSpeech(),
      "Live Find Clients is off because Google Places is not configured.",
    );
  });

  it("Find Clients auto-announce is the Places blocker only", () => {
    const find: CurrentScreenContext = {
      ...settings,
      route: "find",
      screen: "FIND_CLIENTS",
      lookingAt: "You’re looking at Find Clients.",
      important: findClientsBlockerSpeech(),
      facts: [
        { kind: "ERROR", text: "Gmail isn’t connected." },
        { kind: "ERROR", text: findClientsBlockerSpeech() },
      ],
    };
    const auto = autoAnnounceFromScreen(find);
    assert.equal(auto?.text, findClientsBlockerSpeech());
  });
});
