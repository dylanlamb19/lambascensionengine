/**
 * Create the single owner account from server env, only when the user table is empty.
 * In the local/preview sandbox, also RESET the existing owner's email/password
 * so a leftover account from an earlier build can be signed into.
 * Public sign-up stays disabled. Never import this from client code.
 */
import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { isVercelProduction, isWorkspacePreview } from "@/lib/env.server";
import { ownerBootstrapPlan } from "./owner-bootstrap-plan";

export { ownerBootstrapPlan } from "./owner-bootstrap-plan";
export type { OwnerBootstrapAction } from "./owner-bootstrap-plan";

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function productionLike(): boolean {
  if (isVercelProduction()) return true;
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
  const workspacePreview = isWorkspacePreview();
  const vercelProduction = isVercelProduction();
  const prodLike = productionLike();

  const early = ownerBootstrapPlan({
    email,
    password,
    ownerExists: false,
    workspacePreview,
    vercelProduction,
    productionLike: prodLike,
  });
  if (early === "no_env") return { created: false, reason: "no_env" };
  if (early === "default_password_blocked") {
    console.error("[auth] Refusing to bootstrap owner with a default password in production.");
    return { created: false, reason: "default_password_blocked" };
  }

  const sql = await getSql();
  const existing = await sql<{ id: string }>`select id from "user" limit 1`;
  const plan = ownerBootstrapPlan({
    email,
    password,
    ownerExists: existing.length > 0,
    workspacePreview,
    vercelProduction,
    productionLike: prodLike,
  });

  if (plan === "owner_exists") return { created: false, reason: "owner_exists" };
  if (plan === "no_env" || plan === "default_password_blocked") {
    return { created: false, reason: plan };
  }

  const { hashPassword } = await import("better-auth/crypto");
  const hash = await hashPassword(password as string);

  if (plan === "insert_owner") return insertOwner(sql, email as string, hash);
  return resetExistingPreviewOwner(sql, email as string, hash);
}
