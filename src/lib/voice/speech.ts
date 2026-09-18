import { unlockAraOutput } from "./audio-out.ts";

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

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
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

export function speak(text: string, muted: boolean): void {
  if (muted || !ttsSupported()) return;
  unlockAraOutput();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.volume = 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function permissionDeniedPlain(error?: string): string {
  if (error === "not-allowed" || error === "permission-denied") {
    return "Lamb Ascension cannot hear you because microphone permission is off. Use the buttons, or allow the microphone and try again.";
  }
  if (error === "no-speech") return "I didn't catch that. Can you say it again?";
  return "Voice isn’t working in this browser. Everything still works with the buttons.";
}
