export type IntendedUse = "home" | "general" | "social" | "ad" | "client" | "marketing";
export type SafetyStatus = "brand_safe" | "social_safe" | "owner_private" | "not_approved_for_posting";

export const PUBLIC_USES: IntendedUse[] = ["social", "ad", "client", "marketing"];

export function asIntendedUse(raw: string | undefined | null): IntendedUse {
  const t = (raw || "").toLowerCase().trim();
  if (/\b(ad|ads|advertising)\b/.test(t)) return "ad";
  if (t === "home" || t === "background" || t === "wallpaper") return "home";
  if (t === "social" || t === "social media" || t === "post" || /\b(facebook|instagram|linkedin|twitter|social)\b/.test(t)) return "social";
  if (t === "client" || t === "client work" || /\bclient work\b/.test(t)) return "client";
  if (t === "marketing" || t === "public" || /\b(marketing|public)\b/.test(t)) return "marketing";
  return "general";
}

export function isPublicFacing(use: IntendedUse): boolean {
  return PUBLIC_USES.includes(use);
}

export function safetyLabel(status: SafetyStatus): string {
  if (status === "social_safe") return "Social-safe";
  if (status === "brand_safe") return "Brand-safe";
  if (status === "not_approved_for_posting") return "Not approved for posting";
  return "Owner-private";
}

export function evaluateImageSafety(opts: {
  intendedUse: IntendedUse;
  nsfw: boolean;
}): { ok: true; nsfw: boolean; safetyStatus: SafetyStatus } | { ok: false; reason: string; safetyStatus: SafetyStatus } {
  if (isPublicFacing(opts.intendedUse) && opts.nsfw) {
    return {
      ok: false,
      safetyStatus: "not_approved_for_posting",
      reason: "Public, ad, client, and social images have to stay brand-safe. I will not generate or use NSFW for posting.",
    };
  }
  if (opts.nsfw) {
    return { ok: true, nsfw: true, safetyStatus: "owner_private" };
  }
  if (opts.intendedUse === "social") return { ok: true, nsfw: false, safetyStatus: "social_safe" };
  if (isPublicFacing(opts.intendedUse)) return { ok: true, nsfw: false, safetyStatus: "brand_safe" };
  return { ok: true, nsfw: false, safetyStatus: "brand_safe" };
}

export function canUseForPublic(nsfw: boolean, intendedUse: IntendedUse, safetyStatus?: SafetyStatus): boolean {
  if (nsfw) return false;
  if (safetyStatus === "not_approved_for_posting" || safetyStatus === "owner_private") return false;
  if (isPublicFacing(intendedUse)) return true;
  return safetyStatus === "brand_safe" || safetyStatus === "social_safe";
}
