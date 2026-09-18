import type { DesignDocument, DesignOp, SafeDesignSnapshot } from "./types.ts";
import { parseDesignOps } from "./engine.ts";
import { rejectPrivilegeEscalation } from "./guard.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
/** Current Responses API models, oldest last. Official tool-calling path is /v1/responses, not Chat Completions. */
const MODELS = ["gpt-6-astra", "gpt-5.6", "gpt-5", "gpt-4.1", "gpt-4o"];
const MAX_LOOPS = 6;

export type OpenAiToolCall = { name: string; arguments: string; call_id: string };
export type OpenAiTurn = {
  ok: boolean;
  reason?: string;
  spoken: string;
  operations: DesignOp[];
  preview: boolean;
  previousResponseId: string | null;
};

export function designTools() {
  const viewport = { type: "string", description: "global | mobile | desktop. Use mobile or desktop only when the owner scoped the change." };
  return [
    {
      type: "function",
      name: "get_current_design",
      description: "Read the current Home design snapshot. No secrets. Call this first.",
      parameters: { type: "object", properties: {}, additionalProperties: false, required: [] },
      strict: true,
    },
    {
      type: "function",
      name: "apply_design_operations",
      description: "Apply one or more validated design operations to the live Lamb Ascension UI. Never send CSS or JavaScript.",
      parameters: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            items: { type: "object", additionalProperties: true },
            description: "Structured DesignOp objects: move_component, resize_component, hide_component, show_component, emphasize_component, set_spacing, set_typography, set_background, set_background_overlay, set_card_style, set_accent_color, set_visual_density, set_ara_scale, set_main_width, apply_layout, undo_design_change, reset_design.",
          },
          viewport,
          preview: { type: "boolean", description: "true for a large redesign that should be easy to roll back." },
        },
        required: ["operations"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "undo_last_design_change",
      description: "Undo the last committed design change.",
      parameters: { type: "object", properties: {}, additionalProperties: false, required: [] },
      strict: true,
    },
    {
      type: "function",
      name: "restore_session_baseline",
      description: "Restore the look from before this design session started.",
      parameters: { type: "object", properties: {}, additionalProperties: false, required: [] },
      strict: true,
    },
  ];
}

function directorInstructions(snapshot: SafeDesignSnapshot): string {
  return [
    "You are ChatGPT Design Director for Lamb Ascension Owner Mode.",
    "Dylan is the owner. Ara executes your structured design operations on the REAL UI. There is one design engine — never invent CSS, JavaScript, or a parallel theme system.",
    "You have DESIGN AUTHORITY only. You must not request auth, database, Gmail, Calendar, sending, Test Mode, billing, secrets, permissions, or prospect-record changes.",
    "Use get_current_design, then apply_design_operations with structured ops.",
    "Components: greeting, hero (Start My Tasks), status, up_next (Current Task / Up next), needs_you, sales (Revenue/Sales), connections, pipeline, ara.",
    "hero and greeting cannot be hidden. Ara cannot be removed; use set_ara_scale to shrink her.",
    "viewport: omit or global unless Dylan scoped mobile or desktop.",
    "If he says phone / on my phone / mobile, set viewport=mobile. If he says desktop / computer / wider on desktop, set viewport=desktop.",
    "If he says “this” about the screen he is looking at, use the current viewport from the snapshot.",
    "Large redesigns (4+ ops or a full apply_layout): set preview=true so Dylan can Keep / Undo / Try another.",
    "Keep changes tasteful: luxury means quieter gold, stronger hierarchy, more glass, less clutter — not more chrome.",
    `Current viewport: ${snapshot.viewport}. Selected: ${snapshot.selectedComponent || "none"}.`,
    "After tools, reply in 1–2 short sentences describing what you changed. No URLs. No code.",
  ].join("\n");
}

function extractCalls(output: unknown[]): OpenAiToolCall[] {
  const calls: OpenAiToolCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "function_call" && typeof o.name === "string" && typeof o.call_id === "string") {
      calls.push({ name: o.name, arguments: String(o.arguments || "{}"), call_id: o.call_id });
    }
  }
  return calls;
}

function extractText(output: unknown[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "message" && Array.isArray(o.content)) {
      for (const c of o.content) {
        if (c && typeof c === "object" && (c as { type?: string }).type === "output_text") {
          parts.push(String((c as { text?: string }).text || ""));
        }
      }
    }
  }
  return parts.join("\n").trim();
}

async function openaiCreate(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; reason: string; status: number }> {
  let last = "ChatGPT Design Director is unavailable.";
  let lastStatus = 0;
  const models = body.model ? [String(body.model), ...MODELS.filter((m) => m !== body.model)] : MODELS;
  for (const model of models) {
    const payload = { ...body, model };
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    lastStatus = res.status;
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      return { ok: true, json };
    }
    const errText = await res.text().catch(() => "");
    last = res.status === 401
      ? "OpenAI rejected the API key."
      : `ChatGPT Design Director returned ${res.status}.`;
    if (res.status !== 404 && res.status !== 400) {
      return { ok: false, reason: last + (errText ? ` ${errText.slice(0, 180)}` : ""), status: res.status };
    }
  }
  return { ok: false, reason: last, status: lastStatus };
}

export async function runDesignDirectorTurn(opts: {
  apiKey: string;
  prompt: string;
  snapshot: SafeDesignSnapshot;
  document: DesignDocument;
  previousResponseId?: string | null;
  execute: (name: string, args: Record<string, unknown>) => { output: Record<string, unknown>; ops: DesignOp[]; preview: boolean; spoken: string };
}): Promise<OpenAiTurn> {
  let input: unknown[] = [{ role: "user", content: opts.prompt }];
  const collected: DesignOp[] = [];
  let preview = false;
  let spoken = "";
  let previousResponseId = opts.previousResponseId || null;

  for (let i = 0; i < MAX_LOOPS; i++) {
    const body: Record<string, unknown> = {
      model: MODELS[0],
      instructions: directorInstructions(opts.snapshot),
      tools: designTools(),
      tool_choice: "auto",
      input,
      parallel_tool_calls: true,
      max_output_tokens: 900,
    };
    // Session continuity on the first call of a follow-up. Tool-loop iterations
    // accumulate function_call + function_call_output on `input` (official Responses API).
    if (previousResponseId && i === 0) body.previous_response_id = previousResponseId;
    let res = await openaiCreate(opts.apiKey, body);
    if (!res.ok && i === 0 && previousResponseId && (res.status === 400 || res.status === 404)) {
      previousResponseId = null;
      const retryBody = { ...body };
      delete retryBody.previous_response_id;
      res = await openaiCreate(opts.apiKey, retryBody);
    }
    if (!res.ok) return { ok: false, reason: res.reason, spoken: res.reason, operations: collected, preview, previousResponseId };
    const json = res.json;
    previousResponseId = typeof json.id === "string" ? json.id : previousResponseId;
    const output = Array.isArray(json.output) ? json.output : [];
    const calls = extractCalls(output);
    const text = extractText(output) || (typeof json.output_text === "string" ? json.output_text : "");
    if (text) spoken = text;
    if (!calls.length) {
      return { ok: true, spoken: spoken || "No design change.", operations: collected, preview, previousResponseId };
    }
    for (const item of output) input.push(item);
    for (const call of calls) {
      const escalated = rejectPrivilegeEscalation(call.name);
      if (escalated) {
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: false, blocked: true, reason: escalated }) });
        continue;
      }
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.arguments || "{}") as Record<string, unknown>; } catch { args = {}; }
      if (call.name === "apply_design_operations") {
        const ops = parseDesignOps(args.operations);
        if (!ops.length) {
          input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: false, reason: "No valid design operations." }) });
          continue;
        }
        collected.push(...ops);
        if (args.preview === true) preview = true;
      }
      if (call.name === "undo_last_design_change") collected.push({ op: "undo_design_change" });
      if (call.name === "restore_session_baseline") collected.push({ op: "restore_baseline" });
      const executed = opts.execute(call.name, args);
      if (executed.preview) preview = true;
      if (executed.spoken) spoken = executed.spoken;
      collected.push(...executed.ops.filter((op) => !collected.some((c) => JSON.stringify(c) === JSON.stringify(op))));
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(executed.output) });
    }
  }
  return { ok: true, spoken: spoken || "Design updates are on screen.", operations: collected, preview, previousResponseId };
}
