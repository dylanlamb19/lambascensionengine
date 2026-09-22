/**
 * Merge templates with REAL prospect fields only.
 * Never invents emails, names, cities, verticals, or metrics.
 * Unknown placeholders stay empty (fail closed on empty body/subject at arm time).
 */
import type { Prospect } from "../review-brief.ts";
import { usableEmailRoute } from "../prospects/contactability.ts";

export type MergeFields = {
  company: string;
  decision_maker: string;
  vertical: string;
  city: string;
  email: string;
};

export function mergeFieldsFromProspect(p: Prospect): MergeFields {
  const email = usableEmailRoute(p)?.value || "";
  const dm =
    (p.contacts || []).find((c) => c.name && c.name !== "UNKNOWN")?.name ||
    "";
  return {
    company: (p.name || "").trim(),
    decision_maker: dm === "UNKNOWN" ? "" : dm.trim(),
    vertical: (p.vertical || "").trim(),
    city: (p.city || "").trim(),
    email,
  };
}

/** Supports {{field}} and simple {{#field}}...{{/field}} when field non-empty. */
export function mergeTemplate(template: string, fields: MergeFields): string {
  let out = template || "";
  out = out.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, key: string, inner: string) => {
    const v = (fields as Record<string, string>)[key];
    return v ? inner.replace(/\{\{(\w+)\}\}/g, (_m2, k2: string) => (fields as Record<string, string>)[k2] || "") : "";
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => (fields as Record<string, string>)[key] || "");
  return out.trim();
}
