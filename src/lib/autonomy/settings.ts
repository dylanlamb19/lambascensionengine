export type AutonomySettings = {
  autonomous: boolean;
  prospecting: boolean;
  autoSend: boolean;
  autoFollowup: boolean;
  autoReply: boolean;
  /** Explicit owner authorization. Missing or false means Autopilot cannot act. */
  ownerEnabled: boolean;
  ownerEnabledAt: string | null;
  dailySendLimit: number;
  dailyProspectLimit: number;
  bookingUrl: string;
  industries: string[];
  cities: string[];
};

export const DEFAULT_INDUSTRIES = [
  "Roofing",
  "Foundation repair",
  "HVAC",
  "Plumbing",
  "Remodeling",
  "Solar",
  "Med spa",
  "Dentist",
  "Attorney",
  "Business lending",
];

export const DEFAULT_CITIES = ["Dallas", "Fort Worth", "Arlington", "Plano", "Houston"];

export const DEFAULT_AUTONOMY: AutonomySettings = {
  autonomous: false,
  prospecting: false,
  autoSend: false,
  autoFollowup: false,
  autoReply: false,
  ownerEnabled: false,
  ownerEnabledAt: null,
  dailySendLimit: 8,
  dailyProspectLimit: 15,
  bookingUrl: "",
  industries: DEFAULT_INDUSTRIES,
  cities: DEFAULT_CITIES,
};

export const ENABLE_AUTOPILOT_PHRASE = "ENABLE AUTOPILOT";
export const DISABLE_AUTOPILOT_PHRASE = "DISABLE AUTOPILOT";

/** External autonomous actions require a deliberate owner marker, not a leftover true flag. */
export function autopilotAuthorized(settings: Pick<AutonomySettings, "ownerEnabled" | "ownerEnabledAt" | "autonomous"> | null | undefined): boolean {
  if (!settings) return false;
  return settings.ownerEnabled === true && typeof settings.ownerEnabledAt === "string" && settings.ownerEnabledAt.trim().length > 0 && settings.autonomous === true;
}

export function autonomyTickEffects(settings: AutonomySettings, testMode: boolean): { discover: boolean; firstContact: boolean; autoReply: boolean } {
  const on = autopilotAuthorized(settings);
  return {
    discover: on && settings.prospecting,
    firstContact: on && settings.autoSend && !testMode,
    autoReply: on && settings.autoReply && !testMode,
  };
}

/** Changing Test Mode never writes autonomy. */
export function testModeDoesNotTouchAutopilot<T extends AutonomySettings>(settings: T, testMode: boolean): { settings: T; testMode: boolean } {
  return { settings, testMode };
}

export function legacyAutopilotUnauthorized(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const src = raw as Record<string, unknown>;
  const flagged = ["autonomous", "prospecting", "autoSend", "autoFollowup", "autoReply"].some((key) => src[key] === true);
  const marked = src.ownerEnabled === true && typeof src.ownerEnabledAt === "string" && src.ownerEnabledAt.trim().length > 0;
  return flagged && !marked;
}

export function autonomyExecutionOff(raw: unknown): AutonomySettings {
  const base = normalizeAutonomy(raw);
  return {
    ...base,
    autonomous: false,
    prospecting: false,
    autoSend: false,
    autoFollowup: false,
    autoReply: false,
    ownerEnabled: false,
    ownerEnabledAt: null,
  };
}

export function applyAutopilotCommand(current: AutonomySettings, command: string, nowIso: string): { ok: true; audit: string; settings: AutonomySettings } | { ok: false; reason: string } {
  const phrase = (command || "").trim();
  if (phrase === ENABLE_AUTOPILOT_PHRASE) {
    return {
      ok: true,
      audit: "AUTOPILOT_ENABLED",
      settings: {
        ...current,
        ownerEnabled: true,
        ownerEnabledAt: nowIso,
        autonomous: true,
        prospecting: true,
        autoSend: true,
        autoFollowup: true,
        autoReply: true,
      },
    };
  }
  if (phrase === DISABLE_AUTOPILOT_PHRASE) {
    return {
      ok: true,
      audit: "AUTOPILOT_DISABLED",
      settings: {
        ...current,
        ownerEnabled: false,
        autonomous: false,
        prospecting: false,
        autoSend: false,
        autoFollowup: false,
        autoReply: false,
      },
    };
  }
  return { ok: false, reason: "Type ENABLE AUTOPILOT or DISABLE AUTOPILOT exactly. Nothing was changed." };
}

export function normalizeAutonomy(raw: unknown): AutonomySettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (key: keyof AutonomySettings, fallback: boolean) =>
    typeof src[key] === "boolean" ? (src[key] as boolean) : fallback;
  const num = (key: keyof AutonomySettings, fallback: number, max: number) => {
    const n = Number(src[key]);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(max, Math.floor(n));
  };
  const list = (key: keyof AutonomySettings, fallback: string[]) => {
    const v = src[key];
    if (!Array.isArray(v)) return fallback;
    const cleaned = v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 24);
    return cleaned.length ? cleaned : fallback;
  };
  const url = typeof src.bookingUrl === "string" ? src.bookingUrl.trim() : "";
  const ownerEnabledAt = typeof src.ownerEnabledAt === "string" && src.ownerEnabledAt.trim() ? src.ownerEnabledAt.trim() : null;
  const ownerEnabled = src.ownerEnabled === true && Boolean(ownerEnabledAt);
  return {
    autonomous: bool("autonomous", false),
    prospecting: bool("prospecting", false),
    autoSend: bool("autoSend", false),
    autoFollowup: bool("autoFollowup", false),
    autoReply: bool("autoReply", false),
    ownerEnabled,
    ownerEnabledAt: ownerEnabled ? ownerEnabledAt : null,
    dailySendLimit: num("dailySendLimit", DEFAULT_AUTONOMY.dailySendLimit, 40),
    dailyProspectLimit: num("dailyProspectLimit", DEFAULT_AUTONOMY.dailyProspectLimit, 40),
    bookingUrl: /^https?:\/\//i.test(url) ? url : "",
    industries: list("industries", DEFAULT_AUTONOMY.industries),
    cities: list("cities", DEFAULT_AUTONOMY.cities),
  };
}

export function nextMarket(settings: AutonomySettings, tick: number): { vertical: string; city: string } {
  const industries = settings.industries.length ? settings.industries : DEFAULT_INDUSTRIES;
  const cities = settings.cities.length ? settings.cities : DEFAULT_CITIES;
  const n = Math.abs(Math.floor(tick));
  return {
    vertical: industries[n % industries.length]!,
    city: cities[Math.floor(n / industries.length) % cities.length]!,
  };
}
