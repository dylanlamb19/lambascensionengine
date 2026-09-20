export type SpeechHooks = {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (plain: string) => void;
  onEnd?: () => void;
};

type Recog = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string; confidence?: number } }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
};

export const SYSTEM_READER_KEY = "la-system-reader";

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function systemReaderEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(SYSTEM_READER_KEY) === "on";
  } catch {
    return false;
  }
}

export function createRecognizer(): Recog | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "en-US";
  r.interimResults = true;
  r.continuous = true;
  return r;
}

/**
 * Browser speechSynthesis is not Ara.
 * This used to be the automatic fallback and produced a robotic male voice.
 * It is now a no-op so leftover callers cannot change Ara's identity.
 */
export function speak(_text: string, _muted: boolean): void {
  /* no-op — Ara speech goes through AraSpeechController / xAI Ara only */
}

/** Emergency SYSTEM READER. Off by default. Never masquerades as Ara. */
export function speakSystemReader(text: string): void {
  if (!text.trim() || !systemReaderEnabled() || !ttsSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.volume = 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function browserTtsActive(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && Boolean(window.speechSynthesis.speaking);
}

export function permissionDeniedPlain(error?: string): string {
  if (error === "not-allowed" || error === "permission-denied") {
    return "Microphone access is blocked. Enable it in your browser permissions to talk to Ara.";
  }
  if (error === "no-speech") return "I didn't catch that. Can you say it again?";
  return "Voice isn’t working in this browser. Everything still works with the buttons.";
}
