import type { InputMethod } from "./types.ts";

export type VoiceAudit = {
  at: string;
  method: InputMethod;
  tool: string;
  prospectUid: string | null;
  confirmation: string | null;
  result: string;
  /** Never store raw audio. Constructor always writes false. */
  audioStored: boolean;
};

export function makeVoiceAudit(opts: {
  tool: string;
  prospectUid?: string | null;
  confirmation?: string | null;
  result: string;
}): VoiceAudit {
  return {
    at: new Date().toISOString(),
    method: "VOICE",
    tool: opts.tool,
    prospectUid: opts.prospectUid ?? null,
    confirmation: opts.confirmation ?? null,
    result: opts.result,
    audioStored: false,
  };
}

export function auditHasAudio(a: VoiceAudit): boolean {
  return a.audioStored === true;
}
