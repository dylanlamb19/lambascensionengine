import { createFileRoute } from "@tanstack/react-router";
import { handleAccountHttp } from "@/lib/account/http";
import { readAccountBundle, writeAccountBundle } from "@/lib/account/store";
import { FLAGS } from "@/lib/flags";

async function respond(request: Request): Promise<Response> {
  const current = readAccountBundle();
  const result = await handleAccountHttp(request, FLAGS.SELF_SERVE_SIGNUP, current);
  if (result.bundle !== current) writeAccountBundle(result.bundle);
  return result.response;
}

export const Route = createFileRoute("/api/account/$")({
  server: {
    handlers: {
      GET: ({ request }) => respond(request),
      POST: ({ request }) => respond(request),
    },
  },
});
