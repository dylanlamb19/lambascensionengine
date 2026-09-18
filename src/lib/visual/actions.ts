import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEFAULT_VISUAL_THEME, visualFromUnknown, type VisualTheme } from "./theme";

export const loadVisualThemeFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ payload: VisualTheme | string }>`
      select payload from visual_theme where user_id = ${context.userId} limit 1
    `;
    if (!rows[0]) return { ok: true as const, theme: DEFAULT_VISUAL_THEME };
    return { ok: true as const, theme: visualFromUnknown(rows[0].payload) };
  });

export const saveVisualThemeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { theme: VisualTheme }) => data)
  .handler(async ({ data, context }) => {
    const theme = visualFromUnknown(data.theme);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const payload = JSON.stringify(theme);
    await sql`
      insert into visual_theme (user_id, payload, updated_at)
      values (${context.userId}, ${payload}::jsonb, now())
      on conflict (user_id) do update set payload = excluded.payload, updated_at = now()
    `;
    try {
      const { logActivity } = await import("@/lib/prospects/repo.server");
      await logActivity(context.userId, "visual_theme", theme.home.backgroundLabel, undefined, "VOICE");
    } catch {
      /* audit must not block theme */
    }
    return { ok: true as const, theme };
  });
