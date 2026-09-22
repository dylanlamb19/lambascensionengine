import { createHash } from "node:crypto";
import { defaultSeverity, featureForCode, type SentinelCode, type SentinelSeverity } from "./codes.ts";
import type { SentinelEvidence, SentinelFinding } from "./types.ts";

export function findingSignature(code: SentinelCode, extra = ""): string {
  const raw = `${code}|${extra}`.slice(0, 400);
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function serialEvidence(evidence: Record<string, unknown> = {}): SentinelEvidence {
  const out: SentinelEvidence = {};
  for (const [k, v] of Object.entries(evidence)) {
    if (v == null) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

export function makeFinding(
  code: SentinelCode,
  summary: string,
  evidence: Record<string, unknown> = {},
  opts?: {
    severity?: SentinelSeverity;
    reproduction?: string;
    affected?: Array<Record<string, string>>;
    extraKey?: string;
  },
): SentinelFinding {
  return {
    code,
    severity: opts?.severity || defaultSeverity(code),
    feature: featureForCode(code),
    summary,
    evidence: serialEvidence(evidence),
    reproduction: opts?.reproduction,
    affected: opts?.affected,
    signature: findingSignature(code, opts?.extraKey || summary),
  };
}

export function mergeOccurrence(existingCount: number): number {
  return Math.max(1, existingCount) + 1;
}