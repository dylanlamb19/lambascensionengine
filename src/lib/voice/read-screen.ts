import type { CurrentScreenContext, ScreenFact } from "./screen-context.ts";

export type ReadMode = "page" | "everything" | "warning" | "form" | "options";

function join(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p || "").trim()).filter(Boolean).join(" ");
}

function errorFacts(facts: ScreenFact[]): ScreenFact[] {
  return facts.filter((f) => f.kind === "ERROR");
}

export function readScreen(ctx: CurrentScreenContext, mode: ReadMode): string {
  const errors = errorFacts(ctx.facts || []);
  if (mode === "warning") {
    if (!errors.length) return "There’s no warning on this page.";
    return errors.map((f) => f.text).join(" ");
  }
  if (mode === "options") {
    const labels = (ctx.screenActions || []).map((a) => a.label).filter(Boolean);
    if (!labels.length) return "There aren’t any extra actions on this screen.";
    return `You can: ${labels.slice(0, 10).join(", ")}.`;
  }
  if (mode === "form" || mode === "page") {
    return join([ctx.lookingAt, ctx.important, ctx.next]);
  }
  const facts = (ctx.facts || []).map((f) => f.text).join(" ");
  const options = (ctx.screenActions || []).slice(0, 10).map((a) => a.label).filter(Boolean);
  return join([
    ctx.lookingAt,
    ctx.important ? `The important part is: ${ctx.important}` : "",
    facts,
    options.length ? `On this screen you can: ${options.join(", ")}.` : "",
    ctx.next ? `I’d focus on: ${ctx.next}` : "",
  ]);
}

export function autoAnnounceFromScreen(ctx: CurrentScreenContext): { text: string; type: "BLOCKER" | "ERROR" } | null {
  if (/I’m checking your integrations/i.test(ctx.important || "")) return null;
  const errors = errorFacts(ctx.facts || []).filter((f) => !/I’m checking your integrations/i.test(f.text));
  const places = errors.find((f) => /Places is not configured/i.test(f.text));
  if (ctx.screen === "FIND_CLIENTS" && places) {
    return { text: places.text, type: "BLOCKER" };
  }
  if (ctx.screen === "SETTINGS" && /Google isn’t configured yet/i.test(ctx.important || "")) {
    return { text: ctx.important, type: "BLOCKER" };
  }
  if (!errors.length) return null;
  return { text: errors.map((f) => f.text).join(" "), type: "BLOCKER" };
}

export function settingsBlockerSpeech(missingNames: string[]): string {
  const names = missingNames.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) {
    return `Google isn’t configured yet. ${names[0]} is missing, so Gmail and Calendar can’t connect yet.`;
  }
  const last = names[names.length - 1];
  const head = names.slice(0, -1).join(", ");
  return `Google isn’t configured yet. The ${head}, and ${last} are missing, so Gmail and Calendar can’t connect yet.`;
}

export function findClientsBlockerSpeech(): string {
  return "Live Find Clients is off because Google Places is not configured. Add GOOGLE_PLACES_API_KEY, with Places API New and Geocoding API enabled. We will not invent businesses.";
}
