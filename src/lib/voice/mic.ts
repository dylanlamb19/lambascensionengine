export type MicPermission =
  | "UNKNOWN"
  | "REQUESTING"
  | "GRANTED"
  | "DENIED"
  | "BLOCKED"
  | "UNAVAILABLE";

export function micStreamLive(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled !== false);
}

export function stopMicStream(stream: MediaStream | null | undefined): void {
  try {
    stream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
}

export async function queryMicPermission(): Promise<MicPermission> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "UNAVAILABLE";
  try {
    const perms = navigator.permissions;
    if (perms?.query) {
      const status = await perms.query({ name: "microphone" as PermissionName });
      if (status.state === "granted") return "GRANTED";
      if (status.state === "denied") return "BLOCKED";
      return "UNKNOWN";
    }
  } catch {
    /* Safari / embedded browsers often omit microphone from permissions.query */
  }
  return "UNKNOWN";
}

export async function requestMicrophone(): Promise<{
  state: MicPermission;
  stream: MediaStream | null;
  reason?: string;
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { state: "UNAVAILABLE", stream: null, reason: "This browser cannot use a microphone." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (!micStreamLive(stream)) {
      stopMicStream(stream);
      return { state: "UNAVAILABLE", stream: null, reason: "No live microphone track." };
    }
    return { state: "GRANTED", stream };
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return {
        state: "BLOCKED",
        stream: null,
        reason: "Microphone access is blocked. Enable it in your browser permissions to talk to Ara.",
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { state: "UNAVAILABLE", stream: null, reason: "No microphone is available." };
    }
    return { state: "DENIED", stream: null, reason: "Microphone permission is needed to talk to Ara." };
  }
}

export function listeningAllowed(opts: {
  conversationOn: boolean;
  micPermission: MicPermission;
  micStreamActive: boolean;
  voiceSessionReady: boolean;
  micSending: boolean;
}): boolean {
  return (
    opts.conversationOn
    && opts.micPermission === "GRANTED"
    && opts.micStreamActive
    && opts.voiceSessionReady
    && opts.micSending
  );
}

export function micStatusLabel(permission: MicPermission): string {
  if (permission === "BLOCKED" || permission === "DENIED") return "Mic needed";
  if (permission === "UNAVAILABLE") return "Voice input unavailable";
  if (permission === "REQUESTING") return "Asking for mic…";
  return "Mic needed";
}
