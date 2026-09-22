/**
 * Part 6 scaffold — CONTACT_ELIGIBLE_PROSPECTS allowlisted tool backing.
 * Test Mode gated. Never sends. Reports real counts only (no invented leads).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newUid } from "./ids";
import { evaluateContactability } from "./contactability";
import { readTestModeFlag } from "@/lib/mail/test-mode";

export type EligibleSnapshotSummary = {
  id: string;
  testMode: boolean;
  contactableCount: number;
  needsContactCount: number;
  needsResearchCount: number;
  blockedCount: number;
  suppressedCount: number;
  contactableUids: string[];
  createdAt: string;
};

async function loadCooldowns(userId: string): Promise<Map<string, string>> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ prospect_uid: string; cooldown_until: string | Date }>`
      select prospect_uid, cooldown_until
      from prospect_contact_cooldown
      where user_id = ${userId} and cooldown_until > now()
    `;
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.prospect_uid, new Date(r.cooldown_until).toISOString());
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function buildEligibilitySnapshot(userId: string): Promise<EligibleSnapshotSummary> {
  const { listProspects } = await import("./repo.server");
  const { loadSettings } = await import("@/lib/mail/sql.server");
  const settings = await loadSettings(userId);
  const testMode = readTestModeFlag(settings.testMode);
  const prospects = await listProspects(userId);
  const cooldowns = await loadCooldowns(userId);

  let contactableCount = 0;
  let needsContactCount = 0;
  let needsResearchCount = 0;
  let blockedCount = 0;
  let suppressedCount = 0;
  const contactableUids: string[] = [];

  for (const p of prospects) {
    const c = evaluateContactability(p, {
      cooldownUntil: cooldowns.get(p.uid || "") || null,
    });
    switch (c.status) {
      case "CONTACTABLE":
        if (c.contactable) {
          contactableCount += 1;
          if (p.uid) contactableUids.push(p.uid);
        }
        break;
      case "NEEDS_CONTACT_INFORMATION":
        needsContactCount += 1;
        break;
      case "NEEDS_RESEARCH":
        needsResearchCount += 1;
        break;
      case "BLOCKED":
        blockedCount += 1;
        break;
      case "SUPPRESSED":
        suppressedCount += 1;
        break;
    }
  }

  const id = newUid();
  const createdAt = new Date().toISOString();
  const summary: EligibleSnapshotSummary = {
    id,
    testMode,
    contactableCount,
    needsContactCount,
    needsResearchCount,
    blockedCount,
    suppressedCount,
    contactableUids,
    createdAt,
  };

  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into contact_eligibility_snapshots (
        id, user_id, created_at, test_mode,
        contactable_count, needs_contact_count, needs_research_count,
        blocked_count, suppressed_count, payload
      ) values (
        ${id}, ${userId}, ${createdAt}::timestamptz, ${testMode},
        ${contactableCount}, ${needsContactCount}, ${needsResearchCount},
        ${blockedCount}, ${suppressedCount},
        ${JSON.stringify({ contactableUids, note: "AUTH snapshot — no sends" })}::jsonb
      )
    `;
  } catch {
    // Table may not be migrated yet — still return live counts.
  }

  return summary;
}

export const contactEligibleProspectsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const snap = await buildEligibilitySnapshot(context.userId);
    return {
      ok: true as const,
      tool: "CONTACT_ELIGIBLE_PROSPECTS",
      testMode: snap.testMode,
      counts: {
        contactable: snap.contactableCount,
        needsContactInformation: snap.needsContactCount,
        needsResearch: snap.needsResearchCount,
        blocked: snap.blockedCount,
        suppressed: snap.suppressedCount,
      },
      contactableUids: snap.contactableUids,
      snapshotId: snap.id,
      spoken: snap.testMode
        ? `Test Mode is on. ${snap.contactableCount} prospect${snap.contactableCount === 1 ? "" : "s"} currently CONTACTABLE by email. Nothing was sent.`
        : `${snap.contactableCount} prospect${snap.contactableCount === 1 ? "" : "s"} currently CONTACTABLE by email. Nothing was sent.`,
    };
  });
