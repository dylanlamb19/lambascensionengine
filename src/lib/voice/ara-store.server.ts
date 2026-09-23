import { sanitizeAraLog } from "./ara-memory.ts";
import type { AraLog } from "./ara-history.ts";
import { emptyAraLog } from "./ara-history.ts";

export async function loadAraConversation(userId: string): Promise<AraLog> {
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{ log: unknown }>`select log from ara_conversations where user_id = ${userId}`;
    return sanitizeAraLog(rows[0]?.log);
  } catch {
    return emptyAraLog();
  }
}

export async function saveAraConversation(userId: string, log: AraLog): Promise<boolean> {
  const clean = sanitizeAraLog(log);
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    await sql`
      insert into ara_conversations (user_id, log)
      values (${userId}, ${JSON.stringify(clean)}::jsonb)
      on conflict (user_id) do update set log = excluded.log, updated_at = now()
    `;
    return true;
  } catch {
    return false;
  }
}
