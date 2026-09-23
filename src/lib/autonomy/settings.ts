export type AutonomySettings = {
  autonomous: boolean;
  prospecting: boolean;
  autoSend: boolean;
  autoFollowup: boolean;
  autoReply: boolean;
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
  autonomous: true,
  prospecting: true,
  autoSend: true,
  autoFollowup: true,
  autoReply: true,
  dailySendLimit: 8,
  dailyProspectLimit: 15,
  bookingUrl: "",
  industries: DEFAULT_INDUSTRIES,
  cities: DEFAULT_CITIES,
};

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
  return {
    autonomous: bool("autonomous", DEFAULT_AUTONOMY.autonomous),
    prospecting: bool("prospecting", DEFAULT_AUTONOMY.prospecting),
    autoSend: bool("autoSend", DEFAULT_AUTONOMY.autoSend),
    autoFollowup: bool("autoFollowup", DEFAULT_AUTONOMY.autoFollowup),
    autoReply: bool("autoReply", DEFAULT_AUTONOMY.autoReply),
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
