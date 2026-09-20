import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/visual-assets/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { getSessionUser } = await import("@/lib/auth/verify.server");
        const authHeader = request.headers.get("authorization") || "";
        const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : undefined;
        const user = await getSessionUser(bearer);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const { readOwnerAsset } = await import("@/lib/visual/generate");
        const file = await readOwnerAsset(user.id, params.id);
        if (!file) return new Response("Not found", { status: 404 });
        return new Response(new Uint8Array(file.bytes), {
          headers: {
            "Content-Type": file.mime,
            "Cache-Control": "private, max-age=86400",
          },
        });
      },
    },
  },
});
