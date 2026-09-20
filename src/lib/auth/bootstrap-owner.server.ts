/**
 * Create the single owner account from server env, only when the user table is empty.
 * In the local/preview sandbox, also RESET the existing owner's email/password
 * so a leftover account from an earlier build can be signed into.
 * Public sign-up stays disabled. Never import this from client code.
 */
import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { isWorkspacePreview } from "@/lib/env.server";

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function productionLike(): boolean {
  const n = (process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase();
  return n === "production";
}

async function insertOwner(
  sql: Awaited<ReturnType<typeof getSql>>,
  email: string,
  hash: string,
): Promise<{ created: boolean; reason: string }> {
  const now = new Date();
  const userId = randomUUID();
  const accountId = randomUUID();
  try {
    await sql`
      insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${userId}, ${"Owner"}, ${email}, ${true}, ${now}, ${now})
    `;
    await sql`
      insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
      values (${accountId}, ${email}, ${"credential"}, ${userId}, ${hash}, ${now}, ${now})
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) return { created: false, reason: "owner_exists" };
    throw err;
  }
  return { created: true, reason: "bootstrapped" };
}

/** Preview-only: point the first user at OWNER_EMAIL / OWNER_PASSWORD. Never deletes app rows. */
async function resetExistingPreviewOwner(
  sql: Awaited<ReturnType<typeof getSql>>,
  email: string,
  hash: string,
): Promise<{ created: boolean; reason: string }> {
  const now = new Date();
  const existing = await sql<{ id: string }>`select id from "user" order by "createdAt" asc limit 1`;
  if (!existing.length) return { created: false, reason: "owner_missing" };
  const userId = existing[0].id;
  await sql`
    update "user"
    set email = ${email}, "emailVerified" = ${true}, "updatedAt" = ${now}
    where id = ${userId}
  `;
  const accounts = await sql<{ id: string }>`
    select id from "account"
    where "userId" = ${userId} and "providerId" = ${"credential"}
    limit 1
  `;
  if (accounts.length) {
    await sql`
      update "account"
      set password = ${hash}, "accountId" = ${email}, "updatedAt" = ${now}
      where id = ${accounts[0].id}
    `;
  } else {
    await sql`
      insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
      values (${randomUUID()}, ${email}, ${"credential"}, ${userId}, ${hash}, ${now}, ${now})
    `;
  }
  console.info("[auth] Preview owner credentials were reset for local sign-in. App data was not deleted.");
  return { created: false, reason: "preview_reset" };
}

export async function bootstrapOwnerIfNeeded(): Promise<{ created: boolean; reason: string }> {
  const email = env("OWNER_EMAIL")?.toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return { created: false, reason: "no_env" };
  if (productionLike() && (password === "changeme" || password === "change-me")) {
    console.error("[auth] Refusing to bootstrap owner with a default password in production.");
    return { created: false, reason: "default_password_blocked" };
  }

  const sql = await getSql();
  const { hashPassword } = await import("better-auth/crypto");
  const hash = await hashPassword(password);

  const existing = await sql<{ id: string }>`select id from "user" limit 1`;
  if (!existing.length) return insertOwner(sql, email, hash);

  // Deployed apps keep the existing owner. Preview may reset credentials so the
  // known temporary login works against a leftover account. Never wipes prospects.
  if (!isWorkspacePreview()) return { created: false, reason: "owner_exists" };
  return resetExistingPreviewOwner(sql, email, hash);
}
