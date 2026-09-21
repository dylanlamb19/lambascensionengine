"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { FIT, STAGE } from "@/lib/pipeline-copy";
import {
  approveIsPrimary,
  explainCompany,
  highValueTake,
  importantFindings,
  nextStepLabel,
  opportunities,
  recommendOffer,
  whyConsider,
  type Prospect,
} from "@/lib/review-brief";
import { SEED } from "@/lib/seed-prospects";
import { deepResearchFn } from "@/lib/research/run";
import { listProspectsFn, importProspectsFn, upsertProspectsFn } from "@/lib/prospects/sync";
import { matchExisting } from "@/lib/prospects/dedupe";
import { applyByUid, findByUid, patchByUid, withUids } from "@/lib/prospects/identity";
import { ensureUid, newUid, nextClientId } from "@/lib/prospects/ids";
import { contactSummary, ownerQualify } from "@/lib/prospects/qualify";
import { applyProspectFilter, filterChips, filterSummary, fromProspect, isFilterEmpty, type ProspectViewFilter } from "@/lib/prospects/view-filter";
import { loadLastDiscovery, saveLastDiscovery, type LastDiscovery } from "@/lib/prospects/last-discovery";
import { findClientsFn, discoveryStatusFn } from "@/lib/discovery/run";
import { generateOutreach } from "@/lib/outreach/generate";
import { googleStatusFn, salesCountsFn, sendFirstEmailFn, stopSequenceFn, availabilityFn, nextCallFn, prospectUpcomingCallFn, testSettingsFn, calendarAgendaFn, createOwnerCalendarEventFn, listOwnerCalendarEventsFn, deleteOwnerCalendarEventFn, updateOwnerCalendarEventFn, type AgendaEvent } from "@/lib/mail/actions";
import { calendarHealth, gmailHealth, type ConnectionHealth, type IntegrationStatus } from "@/lib/mail/integration-status";
import { EMPTY_TEST_LOOP, isTestWorkflowUid, type TestLoopState } from "@/lib/mail/test-loop";
import { CallCard, OutreachDesk, PrepCard } from "@/components/outreach-desk";
import { TestDesk } from "@/components/test-desk";
import { ProspectReachCard } from "@/components/prospect-reach";
import { VoiceBar } from "@/components/voice-bar";
import { CalendarDesk } from "@/components/calendar-desk";
import { ActionGate, makeActionId } from "@/lib/voice/idempotency";
import { classifyOwnerStopIntent, confirmPhraseOk, confirmSendPhraseOk, confirmSchedulePhraseOk, isClientOwnedStopTool, parseSpokenCommand } from "@/lib/voice/intents";
import { stopSpeaking } from "@/lib/voice/speech";
import { teardownAraOutput, unlockAraOutput } from "@/lib/voice/audio-out";
import { araSpeech, type SpeechSource } from "@/lib/voice/speech-controller";
import { announceToAra, announceSource } from "@/lib/voice/announce";
import { autoAnnounceFromScreen, readScreen } from "@/lib/voice/read-screen";
import { buildScreenContext } from "@/lib/voice/screen-context";
import { queryMicPermission, requestMicrophone, stopMicStream, type MicPermission } from "@/lib/voice/mic";
import type { OwnerView, VoiceMode } from "@/lib/voice/types";
import { AraRealtime, type AraStatus } from "@/lib/voice/ara-client";
import { executeAllowlistedTool, planProspectUid, type AraDeskContext, type ToolResult } from "@/lib/voice/tools";
import {
  applyDeskAction,
  planToAction,
  screenContext,
  spokenToAction,
  type AppAction,
  type DeskEffect,
  type DeskState,
  type DeskWorld,
  type NavFrame,
} from "@/lib/voice/desk-actions";
import { createAraSessionFn, logVoiceAuditFn } from "@/lib/voice/ara-session";
import { voiceFailureReason } from "@/lib/voice/voice-failure";
import { makeVoiceAudit } from "@/lib/voice/audit";
import { araWebResearchFn } from "@/lib/voice/web-research/actions";
import { wrapUntrustedWeb } from "@/lib/voice/web-research/parse";
import type { AraSource } from "@/lib/voice/web-research/types";
import { authClient, rememberSessionToken, signOut as realSignOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { formatLong, formatTime, rangeFor, ymdInTz, type CalView } from "@/lib/calendar/range";
import { OWNER_TZ_DEFAULT, extractOwnerFollowupTitle, isConversationalAside, isExplicitCalendarNavigate, isOwnerCalendarConfirmNo, isOwnerCalendarConfirmYes, isOwnerCalendarCorrection, isOwnerCalendarFollowupName, isOwnerCalendarFollowupTime, isOwnerCalendarRefusalSpeech, ownerCalendarRenameQuestion, ownerEventSpeechFromState, ownerGenericNameQuestion, parseOwnerCalendarManage, parseOwnerCalendarSpeech, pendingOwnerCalExpired, shouldKeepPendingOwnerCalendar, shouldSilenceAraForOwnerCalendar, type LastOwnerEvent, type PendingOwnerCal } from "@/lib/calendar/owner-event";
import { DEFAULT_HOME_LAYOUT, loadHomeLayout, saveHomeLayout, visibleOrder, type HomeLayout, type HomeWidget } from "@/lib/voice/layout";
import {
  DEFAULT_VISUAL_THEME,
  loadVisualThemeLocal,
  nsfwLocked,
  saveVisualThemeLocal,
  summarizeTheme,
  visibleBackgroundUrl,
  visualCssVars,
  type VisualTheme,
} from "@/lib/visual/theme";
import { loadVisualThemeFn, saveVisualThemeFn } from "@/lib/visual/actions";
import { generateImageFn, uploadBackgroundFn, listGalleryFn, deleteGeneratedImageFn, updateGalleryItemFn } from "@/lib/visual/generate";
import {
  EMPTY_GALLERY,
  loadGalleryLocal,
  mergeGalleryItems,
  saveGalleryLocal,
  summarizeGallery,
  type GalleryState,
} from "@/lib/visual/gallery";
import { ImageDock } from "@/components/image-dock";
import { DesignDirectorBar } from "@/components/design-director";
import { FLAGS } from "@/lib/flags";
import {
  araRecommend,
  listingPhone,
  mergeContacts,
  nextResearchStatus,
  reachKind,
  reachLabel,
  telHref,
  taskForProspect,
  usefulEmail,
  verifiedWebsite,
  type ProspectActionId,
} from "@/lib/prospects/reach";
import { startGoogleOAuth, isGoogleOauthMessage, type OauthMissing } from "@/lib/google/launch";
import {
  applyDesignOps,
  cloneDesign,
  designCssVars,
  designFromParts,
  designFromUnknown,
  detectViewport,
  emptyHistory,
  isDesignDirectorUtterance,
  loadDesignLocal,
  resolveDesign,
  safeSnapshot,
  saveDesignLocal,
} from "@/lib/design/engine";
import {
  applyDesignOpsFn,
  designDirectorStatusFn,
  designDirectorTurnFn,
  discardDesignPreviewFn,
  keepDesignPreviewFn,
  loadDesignDocumentFn,
  saveDesignDocumentFn,
  setDesignDirectorPausedFn,
} from "@/lib/design/actions";
import {
  DEFAULT_CHROME,
  type DesignChrome,
  type DesignDocument,
  type DesignDirectorStatus,
  type DesignHistoryState,
  type DesignOp,
} from "@/lib/design/types";

type Light = "green" | "yellow" | "red";
type Task = {
  id: string;
  severity: Light;
  title: string;
  plain: string;
  why: string;
  recommend: string;
  button: string;
  action: string;
  company_uid?: string;
  retry?: boolean;
};

const STORE = "la_companies_v5";
const USAGE = "la_enrich_usage_v1";

function loadCompanies(): Prospect[] {
  if (typeof window === "undefined") return SEED;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return withUids(JSON.parse(raw) as Prospect[]);
  } catch {
    /* ignore */
  }
  return withUids(SEED);
}
function saveCompanies(rows: Prospect[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE, JSON.stringify(rows));
}

function timeGreeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }).format(now),
  );
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, Dylan.`;
}

function buildTasks(rows: Prospect[]): Task[] {
  const tasks: Task[] = [];
  if (!rows.length) {
    tasks.push({
      id: "find", severity: "yellow", title: "Find companies to talk to",
      plain: "Your list is empty.", why: "Nothing to supervise until there are real names.",
      recommend: "Add a company you already know.", button: "Add Client", action: "add",
    });
    return tasks;
  }
  const active = rows.filter((c) => !c.suppressed && c.stage !== "Do Not Contact");
  const rank = (c: Prospect) => {
    if (c.stage === "Call Booked") return 0;
    if (c.stage === "Replied") return 1;
    if (c.stage === "Contacted") return 2;
    if (c.stage === "Approved for Outreach") return 3;
    const k = reachKind(c);
    if (k === "READY_TO_CONTACT") return 4;
    if (k === "NEEDS_CONTACT_INFO") return 5;
    if (k === "NEEDS_RESEARCH") return 6;
    return 7;
  };
  const toTask = (c: Prospect): Task => {
    if (c.stage === "Contacted" || c.stage === "Replied") {
      return {
        id: "follow-" + (c.uid || c.id),
        severity: "yellow",
        title: c.stage === "Replied" ? `${c.name} replied` : `Follow up with ${c.name}`,
        plain: c.stage_plain,
        why: "A live conversation is more valuable than a new first email.",
        recommend: "Open the thread and decide the next move.",
        button: "Learn More",
        action: "open",
        company_uid: c.uid,
      };
    }
    const t = taskForProspect(c);
    const prefix = c.stage === "Call Booked" ? "prep-" : c.stage === "Approved for Outreach" ? "out-" : "reach-";
    return { id: prefix + (c.uid || c.id), ...t, company_uid: c.uid };
  };
  const reachBoost = (c: Prospect) =>
    (usefulEmail(c) ? 4 : 0) + (listingPhone(c) ? 2 : 0) + (verifiedWebsite(c) ? 1 : 0);
  const real = active.filter((c) => !c.is_demo && !isTestWorkflowUid(c.uid)).sort((a, b) => rank(a) - rank(b) || reachBoost(b) - reachBoost(a) || b.score - a.score);
  const demo = active.filter((c) => c.is_demo && !isTestWorkflowUid(c.uid)).sort((a, b) => rank(a) - rank(b) || reachBoost(b) - reachBoost(a) || b.score - a.score);
  for (const c of [...real, ...demo]) tasks.push(toTask(c));
  return tasks;
}

function healthClass(s: ConnectionHealth) {
  return s === "connected" ? "la-dot-good" : s === "attention" || s === "unknown" ? "la-dot-warn" : "la-dot-bad";
}

export function OwnerDesk() {
  const [email, setEmail] = useState("admin@localhost.com");
  const [password, setPassword] = useState("");
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id;
  const [hydrated, setHydrated] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<OwnerView>("home");
  const [rows, setRows] = useState<Prospect[]>(SEED);
  const [taskIx, setTaskIx] = useState<number | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [stack, setStack] = useState<NavFrame[]>([]);
  const [name, setName] = useState("");
  const [web, setWeb] = useState("");
  const [city, setCity] = useState("Fort Worth");
  const [vert, setVert] = useState("Roofing");
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepErr, setDeepErr] = useState("");
  const [syncErr, setSyncErr] = useState("");
  const [syncReady, setSyncReady] = useState(false);
  const [findBusy, setFindBusy] = useState(false);
  const [findMsg, setFindMsg] = useState("");
  const [findLimit, setFindLimit] = useState(8);
  const [findMore, setFindMore] = useState(false);
  const [lastDiscovery, setLastDiscovery] = useState<LastDiscovery | null>(() => loadLastDiscovery());
  const [prospectFilter, setProspectFilter] = useState<ProspectViewFilter>({});
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [google, setGoogle] = useState({ gmail: "unknown" as ConnectionHealth, calendar: "unknown" as ConnectionHealth, configured: false, gmailEmail: "", calendarEmail: "", error: "" });
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [googleMsg, setGoogleMsg] = useState("");
  const [googleErr, setGoogleErr] = useState("");
  const [googleMissing, setGoogleMissing] = useState<OauthMissing[]>([]);
  const [googleNext, setGoogleNext] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [testModeOn, setTestModeOn] = useState(true);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [sales, setSales] = useState({ ready: 0, followups: 0, replies: 0, calls: 0 });
  const [testLoop, setTestLoop] = useState<TestLoopState>(EMPTY_TEST_LOOP);
  const [minRating, setMinRating] = useState(0);
  const [minReviews, setMinReviews] = useState(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResearchRef = useRef(new Set<string>());
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("off");
  const [youSaid, setYouSaid] = useState("");
  const youSaidRef = useRef("");
  const [voiceReply, setVoiceReply] = useState("");
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const gateRef = useRef(new ActionGate());
  const araRef = useRef<AraRealtime | null>(null);
  const araGen = useRef(0);
  const araReconnects = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [araStatus, setAraStatus] = useState<AraStatus>("ready");
  const [araErr, setAraErr] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermission>("UNKNOWN");
  const [micStreamActive, setMicStreamActive] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [outputSpeaking, setOutputSpeaking] = useState(false);
  const [discoveryConfigured, setDiscoveryConfigured] = useState<boolean | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [araSources, setAraSources] = useState<AraSource[]>([]);
  const [calView, setCalView] = useState<CalView>("week");
  const [calAnchor, setCalAnchor] = useState(ymdInTz());
  const [calEventId, setCalEventId] = useState<string | null>(null);
  const [calEvents, setCalEvents] = useState<AgendaEvent[]>([]);
  const [calReason, setCalReason] = useState("");
  const [calLoading, setCalLoading] = useState(false);
  const [calConnected, setCalConnected] = useState(false);
  const [nextCall, setNextCall] = useState<{ prospect_uid: string; start_at: string; title: string } | null>(null);
  const [prospectCall, setProspectCall] = useState<{
    googleEventId: string;
    prospectUid: string;
    title: string;
    start: string;
    end: string;
    status: string;
    googleUrl: string;
  } | null>(null);
  const [rescheduleDraft, setRescheduleDraft] = useState("");
  const [callActionMsg, setCallActionMsg] = useState("");
  const [lastOwnerEvent, setLastOwnerEvent] = useState<LastOwnerEvent | null>(null);
  const lastOwnerEventRef = useRef<LastOwnerEvent | null>(null);
  const pendingOwnerCalRef = useRef<PendingOwnerCal | null>(null);
  const pendingCalManageRef = useRef<{
    kind: "delete" | "update";
    eventId: string;
    title: string;
    when?: string;
    newTime?: string;
    newTitle?: string;
  } | null>(null);
  const [layout, setLayout] = useState<HomeLayout>(DEFAULT_HOME_LAYOUT);
  const [visual, setVisual] = useState<VisualTheme>(DEFAULT_VISUAL_THEME);
  const [chrome, setChrome] = useState<DesignChrome>(DEFAULT_CHROME);
  const [designDoc, setDesignDoc] = useState<DesignDocument>(() => designFromParts());
  const [ddStatus, setDdStatus] = useState<DesignDirectorStatus>("disconnected");
  const [ddPaused, setDdPaused] = useState(false);
  const [ddSpoken, setDdSpoken] = useState("");
  const [ddPreview, setDdPreview] = useState(false);
  const [ddBusy, setDdBusy] = useState(false);
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");
  const designDocRef = useRef<DesignDocument>(designFromParts());
  const designHistoryRef = useRef<DesignHistoryState>(emptyHistory());
  const committedDocRef = useRef<DesignDocument | null>(null);
  const lastDesignPromptRef = useRef("");
  const [gallery, setGallery] = useState<GalleryState>(EMPTY_GALLERY);
  const [adultUnlocked, setAdultUnlocked] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const dispatchRef = useRef<(action: AppAction, source?: "local" | "mirror") => void>(() => {});
  const filePickRef = useRef<HTMLInputElement>(null);
  const pickNsfwRef = useRef(false);

  const tasks = useMemo(() => buildTasks(rows), [rows]);
  const visibleRows = useMemo(
    () => applyProspectFilter(rows.map(fromProspect), prospectFilter, lastDiscovery),
    [rows, prospectFilter, lastDiscovery],
  );
  const liveRef = useRef({
    rows, openUid, view, tasks, google, testModeOn, taskIx, allowlist, sales, testLoop,
    evidence, advanced, stack, vert, city, findLimit, findMsg, voiceReply, explain,
    calView, calAnchor, calEventId, calEvents, calReason, calConnected, nextCall, layout, visual, voiceMode, gallery,
    discoveryConfigured, googleMissing, integration, lastOwnerEvent, lastDiscovery, prospectFilter, youSaid,
  });
  liveRef.current = {
    rows, openUid, view, tasks, google, testModeOn, taskIx, allowlist, sales, testLoop,
    evidence, advanced, stack, vert, city, findLimit, findMsg, voiceReply, explain,
    calView, calAnchor, calEventId, calEvents, calReason, calConnected, nextCall, layout, visual, voiceMode, gallery, discoveryConfigured, googleMissing, integration, lastOwnerEvent, lastDiscovery, prospectFilter, youSaid,
  };
  const readyN = rows.filter((c) => c.stage === "Approved for Outreach" && !c.suppressed && !c.is_demo && !isTestWorkflowUid(c.uid)).length;
  const light: Light = tasks.some((t) => t.severity === "red") ? "red" : tasks.some((t) => t.severity === "yellow") ? "yellow" : "green";
  const headline = light === "red" ? "Needs attention" : light === "yellow" ? "Needs your approval" : "Everything is good";
  const blurb =
    light === "red"
      ? `${tasks.filter((t) => t.severity === "red").length} item(s) broke or got blocked. Software stopped instead of guessing.`
      : light === "yellow"
        ? `${tasks.filter((t) => t.severity === "yellow").length} thing(s) only you can decide. Press Start My Tasks.`
        : "Nothing waiting on you.";

  useEffect(() => {
    if (!userId) return;
    const local = loadCompanies();
    setRows(local);
    setLayout(loadHomeLayout());
    setVisual(loadVisualThemeLocal());
    setGallery(loadGalleryLocal());
    setExplain(null);
    setHydrated(true);
    let cancelled = false;
    void (async () => {
      try {
        const remote = await listProspectsFn();
        if (cancelled || !remote.ok) throw new Error("list");
        if (remote.prospects.length) {
          const extra = local.filter((l) => !matchExisting(remote.prospects, l));
          if (extra.length) await importProspectsFn({ data: { prospects: extra } });
          const latest = extra.length ? await listProspectsFn() : remote;
          if (!cancelled && latest.ok) {
            setRows(latest.prospects);
            saveCompanies(latest.prospects);
          }
        } else if (local.length) {
          const imported = await importProspectsFn({ data: { prospects: local } });
          if (!cancelled && imported.ok && imported.prospects.length) {
            setRows(imported.prospects);
            saveCompanies(imported.prospects);
          }
        }
        if (!cancelled) setSyncErr("");
        try {
          const [g, s] = await Promise.all([googleStatusFn(), salesCountsFn()]);
          if (!cancelled && g.ok) {
            if (g.integration) applyIntegration(g.integration);
            else setGoogle({ gmail: g.gmail, calendar: g.calendar, configured: g.configured, gmailEmail: g.gmailEmail, calendarEmail: g.calendarEmail || "", error: g.error });
          }
          if (!cancelled && s.ok) setSales({ ready: s.ready, followups: s.followups, replies: s.replies, calls: s.calls });
          try {
            const t = await testSettingsFn();
            if (!cancelled && t.ok) {
              setTestModeOn(t.testMode);
              setAllowlist(t.allowlist || []);
              if (t.testLoop) setTestLoop(t.testLoop);
            }
          } catch { /* keep default on */ }
          try {
            const vis = await loadVisualThemeFn();
            if (!cancelled && vis.ok) {
              setVisual(vis.theme);
              saveVisualThemeLocal(vis.theme);
            }
          } catch { /* keep local theme */ }
          try {
            const localDesign = loadDesignLocal();
            const remoteDesign = await loadDesignDocumentFn();
            if (cancelled) return;
            if (remoteDesign.ok && remoteDesign.exists) {
              hydrateDesign(remoteDesign.document, { persist: false });
              if (remoteDesign.preview) {
                committedDocRef.current = cloneDesign(remoteDesign.document);
                hydrateDesign(designFromUnknown(remoteDesign.preview), { preview: true, spoken: "Preview waiting. Keep, undo, or try another." });
              }
              designHistoryRef.current = emptyHistory(remoteDesign.document);
            } else if (localDesign) {
              hydrateDesign(localDesign, { persist: true });
              designHistoryRef.current = emptyHistory(localDesign);
            } else {
              const seed = designFromParts(loadVisualThemeLocal(), loadHomeLayout());
              hydrateDesign(seed, { persist: false });
              designHistoryRef.current = emptyHistory(seed);
            }
          } catch {
            const localDesign = loadDesignLocal();
            if (!cancelled && localDesign) hydrateDesign(localDesign, { persist: false });
          }
          void refreshDirectorStatus();
          try {
            const gal = await listGalleryFn();
            if (!cancelled && gal.ok) {
              setGallery((prev) => {
                const next = { ...prev, items: mergeGalleryItems(prev.items, gal.items), currentId: gal.items[0]?.id || prev.currentId };
                saveGalleryLocal(next);
                return next;
              });
            }
          } catch { /* keep local gallery */ }
        } catch {
          /* keep defaults */
        }
      } catch {
        if (!cancelled) setSyncErr("Lamb Ascension couldn’t load your companies from the server. Your local copy is still safe.");
      } finally {
        if (!cancelled) setSyncReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flag = new URLSearchParams(window.location.search).get("google");
    if (!flag) return;
    if (flag === "connected") {
      setGoogleMsg("Google connected. Gmail identity will show once we verify the account.");
      void refreshIntegration()
        .then(() => {
          const live = liveRef.current;
          if (live.google.gmail === "connected") {
            setGoogleMsg(`Gmail connected${live.google.gmailEmail ? ` · ${live.google.gmailEmail}` : ""}.`);
          } else if (live.google.calendar === "connected") {
            setGoogleMsg("Google Calendar connected.");
          }
        })
        .catch(() => { /* keep last status */ });
    } else if (flag === "denied") {
      setGoogleErr("Google sign-in was cancelled. Nothing was connected.");
    } else if (flag === "failed" || flag === "bad_state") {
      setGoogleErr("Google sign-in didn’t finish. Nothing was connected. Press Connect Gmail to try again.");
    }
    window.history.replaceState({}, "", window.location.pathname || "/");
    // refreshIntegration is a stable function declaration; this effect is a one-shot OAuth return.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!isGoogleOauthMessage(e.data)) return;
      if (e.data.status === "connected") {
        setGoogleErr("");
        setGoogleMsg("Google connected. Checking Gmail identity…");
        void refreshIntegration()
          .then(() => {
            const live = liveRef.current;
            if (live.google.gmail === "connected") {
              setGoogleMsg(`Gmail connected${live.google.gmailEmail ? ` · ${live.google.gmailEmail}` : ""}.`);
            } else if (live.google.calendar === "connected") {
              setGoogleMsg("Google Calendar connected.");
            }
          })
          .catch(() => { /* keep last status */ });
      } else {
        setGoogleErr("Google sign-in didn’t finish. Nothing was connected. Press Connect Gmail to try again.");
      }
    }
    function onFocus() {
      void refreshIntegration().catch(() => { /* ignore */ });
    }
    window.addEventListener("message", onMsg);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("focus", onFocus);
    };
    // refreshIntegration is a stable function declaration used as an event handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const applyVp = () => {
      const vp = detectViewport();
      setViewport(vp);
      const resolved = resolveDesign(designDocRef.current, vp);
      setLayout(resolved.layout);
      setChrome(resolved.chrome);
    };
    applyVp();
    const mql = window.matchMedia("(max-width: 719px)");
    mql.addEventListener("change", applyVp);
    return () => mql.removeEventListener("change", applyVp);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveCompanies(rows);
    if (!syncReady || !userId) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void upsertProspectsFn({ data: { prospects: rows } })
        .then((r) => {
          if (r.ok) setSyncErr("");
          else setSyncErr("Lamb Ascension couldn’t save this change to the server. Your local copy is still safe.");
        })
        .catch(() => setSyncErr("Lamb Ascension couldn’t save this change to the server. Your local copy is still safe."));
    }, 400);
  }, [rows, hydrated, syncReady, userId]);

  function applyIntegration(status: IntegrationStatus) {
    setIntegration(status);
    setGoogle({
      gmail: gmailHealth(status),
      calendar: calendarHealth(status),
      configured: status.google_oauth_configured,
      gmailEmail: status.gmail_identity,
      calendarEmail: status.calendar_identity,
      error: "",
    });
    setTestModeOn(status.test_mode);
    if (status.gmail_connected) {
      setVoiceReply((prev) => {
        if (!prev) return prev;
        if (/Gmail isn’t connected/i.test(prev) && !/token is valid/i.test(prev)) return "";
        return prev;
      });
    }
  }

  async function refreshIntegration() {
    const g = await googleStatusFn();
    if (g.ok && g.integration) applyIntegration(g.integration);
    else if (g.ok) {
      setGoogle({ gmail: g.gmail, calendar: g.calendar, configured: g.configured, gmailEmail: g.gmailEmail, calendarEmail: g.calendarEmail || "", error: g.error });
    }
  }

  function deskWorld(): DeskWorld {
    const live = liveRef.current;
    const next = live.nextCall;
    const companyFor = (uid: string) => live.rows.find((p) => p.uid === uid);
    return {
      prospects: live.rows.map((p) => fromProspect(p)),
      tasks: live.tasks.map((t) => ({ title: t.title, plain: t.plain, uid: t.company_uid, id: t.id, retry: t.retry })),
      gmail: live.integration ? gmailHealth(live.integration) : live.google.gmail,
      calendarStatus: live.integration ? calendarHealth(live.integration) : live.google.calendar,
      calendarUnreadable: Boolean(live.calReason) && live.calConnected,
      calendarReason: live.calReason,
      calendarRange: rangeFor(live.calView, live.calAnchor).label,
      calEvents: live.calEvents.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        status: e.status,
        prospectUid: e.prospectUid,
        companyName: e.companyName,
        kind: e.kind,
      })),
      nextCall: next
        ? {
            prospectUid: next.prospect_uid,
            start: next.start_at,
            title: next.title,
            companyName: companyFor(next.prospect_uid)?.name,
          }
        : null,
      findMsg: live.findMsg,
      testMode: live.testModeOn,
      discoveryConfigured: live.discoveryConfigured,
      missingIntegrations: live.googleMissing,
      integration: live.integration || undefined,
      testLoop: live.testLoop,
      lastDiscovery: live.lastDiscovery || null,
    };
  }

  function currentDesk(): DeskState {
    const live = liveRef.current;
    return {
      view: live.view,
      openUid: live.openUid,
      evidence: live.evidence,
      advanced,
      taskIx: live.taskIx,
      vert: live.vert,
      city: live.city,
      findLimit: live.findLimit,
      prospectFilter: live.prospectFilter || {},
      stack: live.stack,
      explainOpen: Boolean(live.explain),
      lastSpoken: live.voiceReply,
      lastAction: null,
      calView: live.calView,
      calAnchor: live.calAnchor,
      calEventId: live.calEventId,
      layout: live.layout,
      visual: live.visual,
      gallery: live.gallery || { ...EMPTY_GALLERY },
    };
  }

  function applyDeskState(next: DeskState) {
    setView(next.view);
    setOpenUid(next.openUid);
    setEvidence(next.evidence);
    setAdvanced(next.advanced);
    setTaskIx(next.taskIx);
    setVert(next.vert);
    setCity(next.city);
    setFindLimit(next.findLimit);
    setProspectFilter(next.prospectFilter || {});
    setStack(next.stack);
    setCalView(next.calView);
    setCalAnchor(next.calAnchor);
    setCalEventId(next.calEventId);
    if (next.layout) {
      setLayout(next.layout);
      saveHomeLayout(next.layout);
    }
    if (next.visual) {
      setVisual(next.visual);
      saveVisualThemeLocal(next.visual);
      void saveVisualThemeFn({ data: { theme: next.visual } }).catch(() => { /* keep local */ });
      if (next.visual.home.nsfw) setAdultUnlocked(true);
    }
    if (next.layout || next.visual) {
      const updated = cloneDesign({
        ...designDocRef.current,
        layout: next.layout || designDocRef.current.layout,
        visual: next.visual || designDocRef.current.visual,
      });
      designDocRef.current = updated;
      setDesignDoc(updated);
      saveDesignLocal(updated);
      const resolved = resolveDesign(updated, detectViewport());
      setLayout(resolved.layout);
      setVisual(resolved.visual);
      setChrome(resolved.chrome);
      void saveDesignDocumentFn({ data: { document: updated } }).catch(() => { /* keep local */ });
    }
    if (next.lastAction === "IMAGE" && next.gallery) {
      setGallery(next.gallery);
      saveGalleryLocal(next.gallery);
    }
    if (next.lastSpoken && next.lastAction !== "CLOSE_EXPLAIN") {
      const nav = /^(NAVIGATE_|OPEN_FIND|OPEN_ADD|GO_BACK|START_TASKS|CALENDAR_|FILTER_PROSPECTS)/.test(next.lastAction || "");
      const explain = next.lastAction === "EXPLAIN";
      const read = /^READ_/.test(next.lastAction || "");
      setVoiceReply(next.lastSpoken);
      if (liveRef.current.voiceMode === "conversation" && (nav || explain) && !read) {
        /* Conversation Mode: the model narrates tool results. Exact reads still go through Ara TTS. */
      } else {
        const source: SpeechSource = read ? "SCREEN_READER" : nav ? "NAVIGATION" : explain ? "SCREEN_READER" : "TOOL_RESULT";
        utter(next.lastSpoken, source, read ? `read:${next.lastAction}:${next.view}` : undefined);
      }
    }
    if (next.explainOpen) {
      const brief = screenContext(next, deskWorld(), { confirmationOpen: false, testMode: testModeOn });
      setExplain(brief.explain);
    } else {
      setExplain(null);
    }
  }

  function hydrateDesign(doc: DesignDocument, opts?: { persist?: boolean; preview?: boolean; spoken?: string }) {
    const vp = detectViewport();
    const resolved = resolveDesign(doc, vp);
    designDocRef.current = doc;
    setDesignDoc(doc);
    setLayout(resolved.layout);
    setVisual(resolved.visual);
    setChrome(resolved.chrome);
    saveHomeLayout(resolved.layout);
    saveVisualThemeLocal(resolved.visual);
    saveDesignLocal(doc);
    if (resolved.visual.home.nsfw) setAdultUnlocked(true);
    if (opts?.spoken) setDdSpoken(opts.spoken);
    if (opts?.preview) {
      setDdPreview(true);
      setDdStatus("waiting");
    } else if (!opts?.preview) {
      setDdPreview(false);
    }
    if (opts?.persist && !opts.preview) {
      void saveVisualThemeFn({ data: { theme: resolved.visual } }).catch(() => { /* keep local */ });
      void saveDesignDocumentFn({ data: { document: doc } }).catch(() => { /* keep local */ });
    }
  }

  function designPromptText(raw: string): string {
    const stripped = (raw || "")
      .replace(/^(hey |ok |okay |hi |yo )?(ara[,:]?\s+)?(chatgpt|design director)[,:]?\s+/i, "")
      .trim();
    return stripped || raw.trim();
  }

  async function refreshDirectorStatus() {
    try {
      const r = await designDirectorStatusFn();
      if (r.ok) {
        setDdStatus(r.status);
        setDdPaused(r.paused);
      }
    } catch {
      /* keep last */
    }
  }

  async function runDesignDirector(raw: string) {
    const prompt = designPromptText(raw);
    if (prompt.length < 2) {
      setDdSpoken("Say what you want the design to do.");
      return;
    }
    lastDesignPromptRef.current = prompt;
    if (/^stop changing the (design|layout|look|ui)/i.test(prompt) || /^pause (the )?design/i.test(prompt)) {
      try {
        const r = await setDesignDirectorPausedFn({ data: { paused: true } });
        if (r.ok) {
          setDdPaused(true);
          setDdStatus("paused");
        }
      } catch { /* local pause */ }
      setDdPaused(true);
      setDdStatus("paused");
      setDdSpoken("Okay. Design Director is paused. Nothing else will change until you resume.");
      say("Okay. Design Director is paused.");
      return;
    }
    if (/undo what chatgpt/i.test(prompt) || /^undo( that| this)?$/i.test(prompt)) {
      await applyLocalDesignOps([{ op: "undo_design_change" }], "DYLAN");
      return;
    }
    if (/before we started designing|restore (the )?(session )?baseline|put it back how it was/i.test(prompt)) {
      await applyLocalDesignOps([{ op: "restore_baseline" }], "DYLAN");
      return;
    }
    setDdBusy(true);
    setDdStatus("designing");
    setDdSpoken("Designing…");
    committedDocRef.current = cloneDesign(designDocRef.current);
    try {
      const r = await designDirectorTurnFn({
        data: {
          prompt,
          document: designDocRef.current,
          viewport: detectViewport(),
        },
      });
      if (!r.ok) {
        setDdSpoken(r.reason || "ChatGPT Design Director could not finish.");
        setDdStatus(r.paused ? "paused" : "connected");
        if (r.paused) setDdPaused(true);
        if (/disconnected|OpenAI key/i.test(r.reason || "")) setDdStatus("disconnected");
        return;
      }
      if (r.preview) {
        hydrateDesign(r.document, { preview: true, spoken: r.spoken });
        setDdSpoken(r.spoken || "Preview on screen. Keep it, undo, or try another.");
      } else {
        hydrateDesign(r.document, { persist: false, spoken: r.spoken });
        setDdStatus("connected");
        setDdSpoken(r.spoken || "Design updated.");
      }
      if (r.spoken) {
        setVoiceReply(r.spoken);
        utter(r.spoken, "TOOL_RESULT");
      }
    } catch {
      setDdSpoken("ChatGPT Design Director could not finish.");
      setDdStatus("connected");
    } finally {
      setDdBusy(false);
      void refreshDirectorStatus();
    }
  }

  async function applyLocalDesignOps(ops: DesignOp[], actor: "DYLAN" | "ARA" | "CHATGPT_DESIGN_DIRECTOR", preview = false) {
    const previous = cloneDesign(designDocRef.current);
    const applied = applyDesignOps(previous, designHistoryRef.current, { operations: ops, actor, preview });
    designHistoryRef.current = applied.history;
    if (applied.preview || preview) {
      committedDocRef.current = committedDocRef.current || previous;
      hydrateDesign(applied.doc, { preview: true, spoken: applied.spoken });
    } else {
      hydrateDesign(applied.doc, { persist: true, spoken: applied.spoken });
      setDdStatus(ddPaused ? "paused" : "connected");
    }
    setDdSpoken(applied.spoken);
    setVoiceReply(applied.spoken);
    utter(applied.spoken, "TOOL_RESULT");
    try {
      await applyDesignOpsFn({
        data: {
          document: previous,
          operations: ops,
          preview: applied.preview || preview,
          actor,
          liveViewport: detectViewport(),
        },
      });
    } catch {
      /* local copy is already on screen */
    }
  }

  async function keepDesign() {
    const doc = designDocRef.current;
    setDdPreview(false);
    setDdStatus("connected");
    hydrateDesign(doc, { persist: true, spoken: "Kept this design." });
    try {
      await keepDesignPreviewFn({ data: { document: doc } });
    } catch { /* already persisted locally */ }
    setDdSpoken("Kept this design.");
  }

  async function discardDesign() {
    const fallback = committedDocRef.current || designDocRef.current;
    setDdPreview(false);
    hydrateDesign(fallback, { persist: false, spoken: "Undid that design preview." });
    try {
      const r = await discardDesignPreviewFn();
      if (r.ok) hydrateDesign(r.document, { persist: false });
    } catch { /* local rollback already applied */ }
    setDdSpoken("Undid that design preview.");
    setDdStatus("connected");
  }

  function tryAnotherDesign() {
    const prompt = lastDesignPromptRef.current;
    void discardDesign().then(() => {
      if (prompt) void runDesignDirector(`Try another approach. ${prompt}`);
    });
  }

  function noteImage(text: string) {
    setVoiceReply(text);
    utter(text, "TOOL_RESULT");
  }

  async function runImageGeneration(opts: {
    prompt: string;
    n: number;
    kind: GalleryState["lastKind"];
    nsfw: boolean;
    asBackground?: boolean;
    aspectRatio?: string;
    quality?: string;
    style?: string;
    intendedUse?: string;
  }) {
    setGallery((prev) => {
      const next = { ...prev, busy: true, error: null, status: "creating" as const };
      saveGalleryLocal(next);
      return next;
    });
    noteImage("Creating image…");
    try {
      const r = await generateImageFn({
        data: {
          prompt: opts.prompt,
          n: opts.n,
          kind: opts.kind,
          nsfw: opts.nsfw,
          aspectRatio: opts.aspectRatio,
          quality: opts.quality,
          style: opts.style,
          intendedUse: opts.intendedUse,
          asBackground: opts.asBackground,
        },
      });
      if (!r.ok) {
        setGallery((prev) => {
          const next = { ...prev, busy: false, error: r.reason, status: "failed" as const };
          saveGalleryLocal(next);
          return next;
        });
        noteImage(r.reason || "Generation failed.");
        return;
      }
      setGallery((prev) => {
        const next = {
          ...prev,
          busy: false,
          error: null,
          status: "ready" as const,
          items: mergeGalleryItems(prev.items, r.items),
          currentId: r.items[0]?.id || prev.currentId,
          lastPrompt: opts.prompt,
          lastKind: opts.kind,
          lastNsfw: opts.nsfw,
          libraryOpen: liveRef.current.view !== "home" || prev.libraryOpen,
        };
        saveGalleryLocal(next);
        return next;
      });
      const first = r.items[0];
      if (opts.asBackground && first) {
        dispatchRef.current({
          name: "VISUAL",
          visual: { op: "upload", id: first.id, url: first.url, label: first.label, nsfw: first.nsfw, source: "generated" },
        });
        noteImage("Image ready. AI generated. It’s now your Home background.");
      } else {
        noteImage("Image ready. AI generated.");
      }
    } catch {
      setGallery((prev) => {
        const next = { ...prev, busy: false, error: "Generation failed.", status: "failed" as const };
        saveGalleryLocal(next);
        return next;
      });
      noteImage("Generation failed. Nothing was saved. I did not switch to a preset.");
    }
  }

  function runDeskEffect(effect: DeskEffect) {
    if (effect.type === "none") return;
    if (effect.type === "run_find") {
      void runFind({ vertical: effect.vertical, location: effect.location, limit: effect.count });
      return;
    }
    if (effect.type === "research") {
      void researchFurther(effect.uid);
      return;
    }
    if (effect.type === "stop_followups") {
      void stopSequenceFn({ data: { uid: effect.uid } });
      return;
    }
    if (effect.type === "approve") {
      const co = findByUid(liveRef.current.rows, effect.uid);
      if (co) approveProspect(co, "VOICE");
      return;
    }
    if (effect.type === "skip") {
      const co = findByUid(liveRef.current.rows, effect.uid);
      if (co) skipProspect(co, "VOICE");
      return;
    }
    if (effect.type === "generate_outreach") {
      const co = findByUid(liveRef.current.rows, effect.uid);
      if (!co) return;
      const pack = co.outreach || generateOutreach(co);
      patchCompany({ ...co, outreach: pack });
      return;
    }
    if (effect.type === "shorten_email") {
      const co = findByUid(liveRef.current.rows, effect.uid);
      if (!co) return;
      const pack = co.outreach || generateOutreach(co);
      const email = pack.messages.find((m) => m.kind === "email");
      if (!email) return;
      const shorter = email.body.split("\n").filter(Boolean).slice(0, 6).join("\n");
      patchCompany({
        ...co,
        outreach: { ...pack, messages: pack.messages.map((m) => (m.kind === "email" ? { ...m, body: shorter } : m)) },
        history: [...(co.history || []), { at: new Date().toISOString(), action: "edit_email", detail: "Shortened draft (VOICE). Not sent." }],
      });
      return;
    }
    if (effect.type === "arm") {
      const co = findByUid(liveRef.current.rows, effect.uid);
      const fp = effect.intent === "SEND_EMAIL" ? (co?.outreach?.messages.find((m) => m.kind === "email")?.body || "") : "";
      gateRef.current.arm(effect.intent, effect.uid, fp);
      return;
    }
    if (effect.type === "cancel_arm") {
      gateRef.current.cancel();
      return;
    }
    if (effect.type === "scroll") {
      try {
        window.scrollBy({ top: effect.dy, behavior: "smooth" });
      } catch {
        /* ignore */
      }
      return;
    }
    if (effect.type === "visual_generate") {
      void runImageGeneration({
        prompt: effect.prompt,
        n: 1,
        kind: "background",
        nsfw: effect.nsfw,
        asBackground: true,
        aspectRatio: "16:9",
      });
      return;
    }
    if (effect.type === "image_generate") {
      void runImageGeneration(effect);
      return;
    }
    if (effect.type === "image_delete") {
      void deleteGeneratedImageFn({ data: { id: effect.id } }).catch(() => { /* already removed locally */ });
      return;
    }
    if (effect.type === "image_favorite" || effect.type === "image_save" || effect.type === "image_to_ad") {
      void updateGalleryItemFn({
        data: {
          id: effect.id,
          favorite: effect.type === "image_favorite" ? effect.favorite : undefined,
          saved: true,
          kind: effect.type === "image_to_ad" ? "ad" : undefined,
        },
      }).catch(() => { /* local gallery already updated */ });
      return;
    }
    if (effect.type === "pick_background") {
      pickNsfwRef.current = Boolean(effect.nsfw);
      filePickRef.current?.click();
      return;
    }
    if (effect.type === "open_url") {
      window.open(effect.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (effect.type === "dial") {
      const mobile = typeof navigator !== "undefined" && /Mobi|Android|iPhone/i.test(navigator.userAgent);
      if (mobile) {
        window.location.href = telHref(effect.phone);
        return;
      }
      void navigator.clipboard?.writeText(effect.phone)
        .then(() => say(`Call ${effect.phone}. I copied the number — this computer can’t place the call.`))
        .catch(() => say(`Call ${effect.phone}.`));
    }
  }

  async function importPickedFile(file: File, nsfw?: boolean) {
    try {
      const raw = await file.arrayBuffer();
      const bytes = new Uint8Array(raw);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      const r = await uploadBackgroundFn({
        data: {
          filename: file.name,
          mime: file.type || "image/jpeg",
          base64,
          nsfw: Boolean(nsfw),
          label: file.name.replace(/\.[^.]+$/, "") || "Uploaded picture",
        },
      });
      if (!r.ok) {
        setVoiceReply(r.reason);
        return;
      }
      dispatchRef.current({
        name: "VISUAL",
        visual: { op: "upload", id: r.asset.id, url: r.asset.url, label: r.asset.label, nsfw: r.asset.nsfw, source: "upload" },
      });
    } catch {
      setVoiceReply("I couldn’t import that picture.");
    }
  }

  function dispatchAction(action: AppAction, _source: "local" | "mirror" = "local") {
    const { state, effect } = applyDeskAction(currentDesk(), action, deskWorld());
    applyDeskState(state);
    runDeskEffect(effect);
  }
  dispatchRef.current = dispatchAction;

  useEffect(() => {
    const w = window as unknown as { __LA_DISPATCH?: (a: AppAction) => void };
    w.__LA_DISPATCH = (action) => dispatchRef.current(action, "local");
    return () => {
      delete w.__LA_DISPATCH;
    };
  }, []);

  useEffect(() => {
    if (!userId || view !== "calendar") return;
    const { from, to } = rangeFor(calView, calAnchor);
    setCalLoading(true);
    void calendarAgendaFn({ data: { from: from.toISOString(), to: to.toISOString() } })
      .then((r) => {
        setCalEvents(r.events || []);
        setCalReason(r.ok ? "" : r.reason);
        setCalConnected(Boolean(r.connected));
      })
      .catch(() => {
        setCalReason("Google Calendar returned a response Lamb Ascension couldn’t parse. (CALENDAR_LIST_PARSE_FAILED)");
        setCalEvents([]);
      })
      .finally(() => setCalLoading(false));
  }, [userId, view, calView, calAnchor]);

  useEffect(() => {
    if (!userId) return;
    void nextCallFn()
      .then((r) => {
        if (r.ok && r.call) setNextCall(r.call);
        else setNextCall(null);
      })
      .catch(() => setNextCall(null));
  }, [userId, view]);

  useEffect(() => {
    if (!userId || view !== "detail" || !openUid) {
      if (view !== "detail") setProspectCall(null);
      return;
    }
    void refreshProspectCall(openUid);
  }, [userId, view, openUid]);

  const prospectDeepLinkOpened = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || prospectDeepLinkOpened.current) return;
    if (!userId || !rows.length) return;
    const uid = new URLSearchParams(window.location.search).get("p")?.trim();
    if (!uid) return;
    prospectDeepLinkOpened.current = true;
    dispatchRef.current({ name: "OPEN_PROSPECT", uid });
  }, [userId, rows]);

  function refreshCalendarAgenda() {
    if (!userId) return;
    const { from, to } = rangeFor(calView, calAnchor);
    void calendarAgendaFn({ data: { from: from.toISOString(), to: to.toISOString() } })
      .then((r) => {
        setCalEvents(r.events || []);
        setCalReason(r.ok ? "" : r.reason);
        setCalConnected(Boolean(r.connected));
      })
      .catch(() => {});
    void nextCallFn()
      .then((r) => {
        if (r.ok && r.call) setNextCall(r.call);
        else setNextCall(null);
      })
      .catch(() => {});
  }

  async function refreshProspectsAndSales() {
    try {
      const [latest, s] = await Promise.all([listProspectsFn(), salesCountsFn()]);
      if (latest.ok) {
        setRows(latest.prospects);
        saveCompanies(latest.prospects);
      }
      if (s.ok) setSales({ ready: s.ready, followups: s.followups, replies: s.replies, calls: s.calls });
    } catch { /* keep last */ }
  }

  async function refreshProspectCall(uid: string | null) {
    if (!uid) {
      setProspectCall(null);
      return;
    }
    try {
      const r = await prospectUpcomingCallFn({ data: { uid } });
      setProspectCall(r.ok ? r.call : null);
    } catch {
      setProspectCall(null);
    }
  }

  function openProspectCallCalendar() {
    const call = prospectCall;
    if (call?.googleUrl) window.open(call.googleUrl, "_blank", "noopener,noreferrer");
    if (call) {
      dispatchAction({ name: "NAVIGATE_CALENDAR" });
      dispatchAction({ name: "OPEN_CALENDAR_EVENT", eventId: call.googleEventId });
    }
  }

  async function rescheduleProspectCall() {
    const call = prospectCall;
    const when = rescheduleDraft.trim();
    if (!call || !when) {
      setCallActionMsg("What time should I move it to?");
      return;
    }
    setCallActionMsg("");
    try {
      const r = await updateOwnerCalendarEventFn({
        data: { eventId: call.googleEventId, newTime: when, confirm: true },
      });
      if (r.ok && r.updated) {
        setRescheduleDraft("");
        setCallActionMsg(`Moved to ${r.whenLabel}.`);
        refreshCalendarAgenda();
        void refreshProspectCall(call.prospectUid);
        void refreshProspectsAndSales();
      } else {
        setCallActionMsg(r.spoken || "I couldn't update that event, so nothing changed.");
      }
    } catch {
      setCallActionMsg("I couldn't update that event, so nothing changed.");
    }
  }

  async function cancelProspectCall() {
    const call = prospectCall;
    if (!call) return;
    setCallActionMsg("");
    try {
      const r = await deleteOwnerCalendarEventFn({
        data: { eventId: call.googleEventId, confirm: true },
      });
      if (r.ok && r.deleted) {
        setProspectCall(null);
        setCallActionMsg("Call cancelled.");
        refreshCalendarAgenda();
        void refreshProspectsAndSales();
      } else {
        setCallActionMsg(r.spoken || "I couldn't update that event, so nothing changed.");
      }
    } catch {
      setCallActionMsg("I couldn't update that event, so nothing changed.");
    }
  }

  async function connectGoogle(kind: "gmail" | "calendar") {
    setGoogleErr("");
    setGoogleMsg("");
    setGoogleMissing([]);
    setGoogleNext("");
    setGoogleUrl("");
    try {
      const res = await startGoogleOAuth(kind, { allowPopup: google.configured });
      setGoogleMissing(res.missing);
      setGoogleNext(res.next);
      if (res.url) setGoogleUrl(res.url);
      if (!res.ok) {
        setGoogleErr(res.reason);
        say(res.reason);
        return;
      }
      setGoogleMsg(res.reason);
    } catch {
      setGoogleErr("Could not start Google sign-in. Nothing was connected.");
    }
  }

  function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    void (async () => {
      try {
        const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
        if (data && !error) {
          rememberSessionToken((data as { token?: string | null }).token);
          try { await authClient.getSession(); } catch { /* session store recovers */ }
          setBusy(false);
          return;
        }
        const code = (error as { code?: string } | null)?.code || "";
        const status = (error as { status?: number } | null)?.status;
        if (code === "INVALID_EMAIL") {
          setErr("That email isn’t complete. Use admin@localhost.com, then press Enter.");
        } else if (!error || status === 404 || status === 500 || status === 502 || status === 503) {
          setErr("Lamb Ascension couldn’t reach the sign-in service. Press Enter to try again.");
        } else {
          setErr("We couldn't sign you in. Check the email and password, then press Enter.");
        }
      } catch {
        setErr("Lamb Ascension couldn’t reach the sign-in service. Press Enter to try again.");
      } finally {
        setBusy(false);
      }
    })();
  }

  function runTask(t: Task) {
    if (t.action === "add") {
      dispatchAction({ name: "OPEN_ADD_CLIENT" });
      return;
    }
    if (t.action === "find_contact" && t.company_uid) {
      dispatchAction({ name: "FIND_CONTACT", uid: t.company_uid });
      return;
    }
    if (t.action === "open" && t.company_uid) {
      dispatchAction({ name: "OPEN_REVIEW", uid: t.company_uid });
      return;
    }
    if (t.action === "outreach" && t.company_uid) {
      dispatchAction({ name: "OPEN_OUTREACH", uid: t.company_uid });
      return;
    }
    if (t.action === "prep" && t.company_uid) {
      dispatchAction({ name: "READ_CALL_OPENER", uid: t.company_uid });
    }
  }

  function runProspectAction(uid: string | undefined, id: ProspectActionId) {
    if (!uid && id !== "skip") {
      say("Which company do you mean?");
      return;
    }
    if (id === "learn_more") {
      dispatchAction({ name: "OPEN_REVIEW", uid });
      return;
    }
    if (id === "open_website") {
      dispatchAction({ name: "OPEN_WEBSITE", uid });
      return;
    }
    if (id === "call") {
      dispatchAction({ name: "CALL_PROSPECT", uid });
      return;
    }
    if (id === "find_contact" || id === "try_research") {
      dispatchAction({ name: "FIND_CONTACT", uid });
      return;
    }
    if (id === "draft_outreach" || id === "draft_email") {
      dispatchAction({ name: "DRAFT_OUTREACH", uid });
      return;
    }
    if (id === "skip") {
      dispatchAction({ name: "SKIP_CURRENT_TASK", uid });
    }
  }

  function patchCompany(next: Prospect) {
    setRows((prev) => patchByUid(prev, ensureUid(next)));
  }

  function utter(text: string, source: SpeechSource, dedupeKey?: string) {
    const clean = (text || "").trim();
    if (!clean) return;
    setVoiceReply(clean);
    araSpeech().setMuted(voiceMuted);
    void araSpeech().speakAsAra(clean, { source, exact: true, dedupeKey });
  }

  function say(text: string) {
    utter(text, "TOOL_RESULT");
  }

  function araDesk(): AraDeskContext {
    const live = liveRef.current;
    const state = currentDesk();
    const world = deskWorld();
    const ctx = screenContext(state, world, { confirmationOpen: false, testMode: live.testModeOn });
    const company = live.rows.find((p) => p.uid === (live.openUid || ctx.openUid));
    return {
      view: live.view,
      openUid: live.openUid,
      companyName: company?.name || null,
      taskTitle: live.taskIx != null ? live.tasks[live.taskIx]?.title || null : null,
      tasks: live.tasks.map((t) => ({ title: t.title, plain: t.plain })),
      prospects: live.rows.map((p) => ({
        uid: p.uid || "",
        name: p.name,
        stage: p.stage,
        stage_plain: p.stage_plain,
        score: p.score,
        fit_plain: p.fit_plain,
        research_status: p.research_status,
        review_count: p.review_count,
        website: p.website,
        phone: listingPhone(p)?.value || "",
        reach: reachKind(p),
        recommend: araRecommend(p),
        explain: explainCompany(p),
        emailDraft: p.outreach?.messages.find((m) => m.kind === "email")?.body || "",
        reply: p.outreach?.messages.find((m) => m.kind === "reply")?.body
          || (p.history || []).filter((h) => /reply/i.test(h.action) || /reply/i.test(h.detail)).at(-1)?.detail
          || "",
        recipient: usefulEmail(p)?.value || "",
        decisionMaker: (() => {
          const c = (p.contacts || []).find((x) => x.name && x.name !== "UNKNOWN");
          if (!c) return "";
          return c.title && c.title !== "UNKNOWN" ? `${c.name}, ${c.title}` : c.name;
        })(),
        vertical: p.vertical,
        city: p.city,
        address: p.address || "",
        category: p.provider_category || "",
        place_id: p.provider_place_id || "",
        website_note: p.website_note || "",
        readiness: p.readiness || "",
        readiness_why: p.readiness_why || ownerQualify(p).why,
        contact_summary: contactSummary(p),
        opportunity_summary: opportunities(p).map((o) => o.title).join("; "),
        fit_headline: ownerQualify(p).headline,
        is_demo: Boolean(p.is_demo),
        is_test: isTestWorkflowUid(p.uid),
        discovered_at: p.discovered_at || "",
        google_rating: p.google_rating,
        provider: p.provider || "",
      })),
      gmail: live.integration ? gmailHealth(live.integration) : live.google.gmail,
      calendar: live.integration ? calendarHealth(live.integration) : live.google.calendar,
      testMode: live.testModeOn,
      allowlist: live.allowlist,
      sales: live.sales,
      testLoop: live.testLoop,
      availableActions: Array.from(new Set([
        ...ctx.availableActions,
        "create_owner_calendar_event",
        "get_last_owner_calendar_event",
        "list_owner_calendar_events",
        "delete_owner_calendar_event",
        "update_owner_calendar_event",
      ])),
      confirmationOpen: false,
      evidenceOpen: live.evidence,
      pipelineStage: company?.stage_plain || null,
      screen: ctx.screen,
      taskId: ctx.taskId,
      taskUid: ctx.taskUid,
      screenActions: ctx.screenActions,
      lookingAt: ctx.lookingAt,
      important: ctx.important,
      nextFocus: ctx.next,
      screenFacts: ctx.facts,
      calendarView: live.calView,
      calendarRange: rangeFor(live.calView, live.calAnchor).label,
      calendarEvents: live.calEvents.map((e) => ({
        id: e.id,
        title: e.title,
        when: e.start,
        prospectUid: e.prospectUid,
        companyName: e.companyName,
      })),
      selectedEventId: live.calEventId,
      lastOwnerEvent: lastOwnerEventRef.current || live.lastOwnerEvent || null,
      timezone: OWNER_TZ_DEFAULT,
      visual: live.visual,
      visualSummary: summarizeTheme(live.visual),
      adultMode: live.visual.adultMode,
      imageGenAvailable: true,
      gallery: live.gallery,
      gallerySummary: summarizeGallery(live.gallery?.items || [], live.gallery?.currentId),
      designSnapshot: safeSnapshot(designDocRef.current, detectViewport()),
      integration: live.integration || undefined,
      lastDiscovery: live.lastDiscovery || null,
      prospectFilter: live.prospectFilter || {},
      lastOwnerUtterance: youSaidRef.current || live.youSaid || "",
    };
  }

  async function hydrateAraOutput(name: string, result: ToolResult): Promise<Record<string, unknown>> {
    if (result.plan.type === "web_research" || result.plan.type === "read_page") {
      try {
        const live = liveRef.current;
        const uid = result.plan.type === "web_research" ? result.plan.uid : live.openUid || undefined;
        const company = uid ? live.rows.find((p) => p.uid === uid) : undefined;
        const r = await araWebResearchFn({
          data: {
            query: result.plan.type === "web_research" ? result.plan.query : "",
            mode: result.plan.type === "read_page" ? "page" : result.plan.mode,
            url: result.plan.type === "read_page" ? result.plan.url : undefined,
            prospectUid: uid,
            prospectContext: company ? `${company.name} · ${company.vertical} · ${company.city}` : undefined,
          },
        });
        if (r.sources?.length) setAraSources(r.sources);
        if (!r.ok) {
          return { ...result.output, ok: false, reason: r.reason, staysOnScreen: true, changed: false, ...wrapUntrustedWeb("web", r.reason || "") };
        }
        return {
          ...result.output,
          ok: true,
          spoken: r.spoken,
          sources: r.sources,
          staysOnScreen: true,
          changed: false,
          cached: r.cached,
          ...wrapUntrustedWeb("web", r.answer),
        };
      } catch {
        return { ok: false, reason: "I couldn’t look that up.", staysOnScreen: true, changed: false };
      }
    }
    if (name === "get_calendar_availability" || name === "get_next_call") {
      try {
        const [avail, next] = await Promise.all([availabilityFn(), nextCallFn()]);
        return {
          ...result.output,
          availability: avail.ok ? avail : { ok: false, reason: avail.reason },
          nextCall: next.ok && next.call ? next.call : null,
          failClosed: !avail.ok && name === "get_calendar_availability",
        };
      } catch {
        return { ok: false, reason: "Calendar could not be read. Nothing was booked." };
      }
    }
    if (result.plan.type === "owner_calendar_event") {
      const plan = result.plan;
      const fpKey = `${plan.title}|${plan.when || ""}|${plan.durationMinutes || 30}`;
      if (gateRef.current.seen(`create_owner_calendar_event:${fpKey}`, 20_000) && lastOwnerEventRef.current) {
        const last = lastOwnerEventRef.current;
        return {
          ok: true,
          created: true,
          alreadyExisted: true,
          eventId: last.id,
          title: last.title,
          whenLabel: last.whenLabel,
          start: last.start,
          end: last.end,
          attendees: 0,
          prospect: false,
          sales: false,
          emailSent: false,
          spoken: `Done — I added ‘${last.title}’ to your calendar for ${last.whenLabel}.`,
        };
      }
      try {
        const r = await createOwnerCalendarEventFn({
          data: {
            title: plan.title,
            when: plan.when,
            date: plan.date,
            time: plan.time,
            durationMinutes: plan.durationMinutes,
            description: plan.description,
            location: plan.location,
            requestId: plan.requestId,
            origin: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
        if (!r.ok) {
          return {
            ok: false,
            created: false,
            need: "need" in r ? r.need : undefined,
            question: "question" in r ? r.question : undefined,
            reason: "reason" in r ? r.reason : undefined,
            spoken: r.spoken,
            title: "title" in r ? r.title : plan.title,
            when: "when" in r ? r.when : plan.when,
            matches: "matches" in r ? r.matches : undefined,
            attendees: 0,
            prospect: false,
            sales: false,
            emailSent: false,
          };
        }
        const last: LastOwnerEvent = {
          id: r.eventId,
          title: r.title,
          whenLabel: r.whenLabel,
          start: r.start,
          end: r.end,
          fingerprint: r.fingerprint,
        };
        lastOwnerEventRef.current = last;
        setLastOwnerEvent(last);
        refreshCalendarAgenda();
        if (r.prospect) {
          void refreshProspectsAndSales();
          if (r.prospectUid) void refreshProspectCall(r.prospectUid);
        }
        return {
          ok: true,
          created: true,
          alreadyExisted: r.alreadyExisted,
          eventId: r.eventId,
          title: r.title,
          whenLabel: r.whenLabel,
          start: r.start,
          end: r.end,
          fingerprint: r.fingerprint,
          attendees: 0,
          guests: 0,
          prospect: r.prospect,
          prospectUid: r.prospectUid,
          sales: r.sales,
          emailSent: false,
          spoken: r.spoken,
        };
      } catch {
        return {
          ok: false,
          created: false,
          spoken: "I couldn't create that event, so nothing was added.",
          attendees: 0,
          prospect: false,
          sales: false,
          emailSent: false,
        };
      }
    }
    if (result.plan.type === "owner_calendar_list") {
      try {
        const r = await listOwnerCalendarEventsFn({ data: { when: result.plan.when, title: result.plan.title } });
        return { ...result.output, ...r, spoken: r.spoken };
      } catch {
        return { ok: false, listed: false, spoken: "Google Calendar returned a response Lamb Ascension couldn’t parse. (CALENDAR_LIST_PARSE_FAILED)" };
      }
    }
    if (result.plan.type === "owner_calendar_delete") {
      try {
        const r = await deleteOwnerCalendarEventFn({
          data: {
            eventId: result.plan.eventId,
            title: result.plan.title,
            when: result.plan.when,
            lastEvent: result.plan.lastEvent,
            lastEventId: lastOwnerEventRef.current?.id,
            confirm: result.plan.confirm,
          },
        });
        if (r.ok && r.deleted) {
          if (lastOwnerEventRef.current?.id === r.eventId) {
            lastOwnerEventRef.current = null;
            setLastOwnerEvent(null);
          }
          if (r.eventId) gateRef.current.seen(`delete_owner_calendar_event:${r.eventId}`, 20_000);
          refreshCalendarAgenda();
        }
        if ("needsConfirm" in r && r.needsConfirm && r.eventId) {
          pendingCalManageRef.current = { kind: "delete", eventId: r.eventId, title: r.title, when: result.plan.when };
        }
        return { ...result.output, ...r };
      } catch {
        return { ok: false, deleted: false, spoken: "I couldn't update that event, so nothing changed." };
      }
    }
    if (result.plan.type === "owner_calendar_update") {
      try {
        const r = await updateOwnerCalendarEventFn({
          data: {
            eventId: result.plan.eventId,
            title: result.plan.title,
            when: result.plan.when,
            lastEvent: result.plan.lastEvent,
            lastEventId: lastOwnerEventRef.current?.id,
            newTime: result.plan.newTime,
            newTitle: result.plan.newTitle,
            confirm: result.plan.confirm,
          },
        });
        if (r.ok && r.updated) {
          const last: LastOwnerEvent = {
            id: r.eventId,
            title: r.title,
            whenLabel: r.whenLabel,
            start: r.start,
            end: r.end,
            fingerprint: lastOwnerEventRef.current?.fingerprint || `update:${r.eventId}`,
          };
          lastOwnerEventRef.current = last;
          setLastOwnerEvent(last);
          refreshCalendarAgenda();
        }
        if ("needsConfirm" in r && r.needsConfirm && r.eventId) {
          pendingCalManageRef.current = {
            kind: "update",
            eventId: r.eventId,
            title: r.title,
            when: result.plan.when,
            newTime: result.plan.newTime,
            newTitle: result.plan.newTitle,
          };
        }
        return { ...result.output, ...r };
      } catch {
        return { ok: false, updated: false, spoken: "I couldn't update that event, so nothing changed." };
      }
    }
    return result.output;
  }

  async function runOwnerPersonalCalendar(text: string): Promise<boolean> {
    const pendingManage = pendingCalManageRef.current;
    if (pendingManage && isOwnerCalendarConfirmYes(text)) {
      araRef.current?.cancelResponse();
      pendingCalManageRef.current = null;
      const tool = pendingManage.kind === "delete" ? "delete_owner_calendar_event" : "update_owner_calendar_event";
      const result = executeAllowlistedTool(tool, {
        event_id: pendingManage.eventId,
        title: pendingManage.title,
        when: pendingManage.when,
        new_time: pendingManage.newTime,
        new_title: pendingManage.newTitle,
        confirm: true,
      }, araDesk(), "owner_session");
      const output = await hydrateAraOutput(tool, result);
      utter(String(output.spoken || "I couldn't update that event, so nothing changed."), "TOOL_RESULT");
      return true;
    }
    if (pendingManage && isOwnerCalendarConfirmNo(text)) {
      araRef.current?.cancelResponse();
      pendingCalManageRef.current = null;
      utter("Okay, I left it on your calendar.", "TOOL_RESULT");
      return true;
    }

    const lastAsk = /\bwhat did you (just )?add\b|\bwhat did you (just )?put on (my )?calendar\b/i.test(text);
    if (lastAsk) {
      araRef.current?.cancelResponse();
      utter(ownerEventSpeechFromState(lastOwnerEventRef.current), "TOOL_RESULT");
      return true;
    }

    const manage = parseOwnerCalendarManage(text);
    if (manage.kind !== "none") {
      pendingCalManageRef.current = null;
      araRef.current?.cancelResponse();
      if (manage.kind === "list") {
        const result = executeAllowlistedTool("list_owner_calendar_events", { when: manage.when, title: manage.title }, araDesk(), "owner_session");
        const output = await hydrateAraOutput("list_owner_calendar_events", result);
        utter(String(output.spoken || "I couldn’t read your Google Calendar."), "TOOL_RESULT");
        return true;
      }
      if (manage.kind === "delete") {
        const result = executeAllowlistedTool("delete_owner_calendar_event", {
          title: manage.title,
          when: manage.when,
          last_event: manage.lastEvent,
          event_id: manage.lastEvent ? lastOwnerEventRef.current?.id : undefined,
        }, araDesk(), "owner_session");
        const output = await hydrateAraOutput("delete_owner_calendar_event", result);
        utter(String(output.spoken || "I couldn't find a matching event, so I didn't delete anything."), "TOOL_RESULT");
        return true;
      }
      const result = executeAllowlistedTool("update_owner_calendar_event", {
        title: manage.title,
        when: manage.when,
        last_event: manage.lastEvent,
        event_id: manage.lastEvent ? lastOwnerEventRef.current?.id : undefined,
        new_time: manage.newTime,
        new_title: manage.newTitle,
      }, araDesk(), "owner_session");
      const output = await hydrateAraOutput("update_owner_calendar_event", result);
      utter(String(output.spoken || "I couldn't update that event, so nothing changed."), "TOOL_RESULT");
      return true;
    }

    const pending = pendingOwnerCalRef.current;
    if (pending && pendingOwnerCalExpired(pending)) {
      pendingOwnerCalRef.current = null;
    }
    const livePending = pendingOwnerCalRef.current;

    if (isOwnerCalendarCorrection(text)) {
      araRef.current?.cancelResponse();
      if (livePending && (livePending.need === "name" || livePending.need === "which" || !livePending.eventId)) {
        pendingOwnerCalRef.current = { ...livePending, need: "name", intent: "create", at: Date.now() };
        utter(ownerGenericNameQuestion(livePending.title || "call"), "TOOL_RESULT");
        return true;
      }
      const last = lastOwnerEventRef.current;
      if (last?.id) {
        pendingOwnerCalRef.current = {
          title: last.title,
          when: last.whenLabel,
          need: "name",
          intent: "rename",
          eventId: last.id,
          at: Date.now(),
        };
        utter(ownerCalendarRenameQuestion(), "TOOL_RESULT");
        return true;
      }
      utter("What should I name the call?", "TOOL_RESULT");
      return true;
    }

    if (livePending && isConversationalAside(text)) {
      return false;
    }

    const parsed = parseOwnerCalendarSpeech(text);
    let title = "";
    let when = "";
    let renameId = "";
    if (livePending?.intent === "rename" && livePending.eventId && isOwnerCalendarFollowupName(text)) {
      title = extractOwnerFollowupTitle(text);
      renameId = livePending.eventId;
      pendingOwnerCalRef.current = null;
    } else if (parsed.matched) {
      title = parsed.title;
      when = parsed.when;
      pendingOwnerCalRef.current = null;
    } else if (livePending && isOwnerCalendarFollowupTime(text)) {
      title = livePending.title;
      when = `${livePending.when} ${text}`.trim();
      pendingOwnerCalRef.current = null;
    } else if (livePending && (livePending.need === "name" || livePending.need === "which") && isOwnerCalendarFollowupName(text)) {
      title = extractOwnerFollowupTitle(text);
      when = livePending.when;
      pendingOwnerCalRef.current = null;
    } else if (livePending && /\b(cancel|never mind|forget it)\b/i.test(text) && text.trim().length < 24) {
      pendingOwnerCalRef.current = null;
      araRef.current?.cancelResponse();
      utter("Okay, I won’t add that.", "TOOL_RESULT");
      return true;
    } else {
      if (livePending && !shouldKeepPendingOwnerCalendar(text, livePending)) {
        const cmd = parseSpokenCommand(text);
        if (cmd.intent !== "UNKNOWN" && cmd.confidence >= 0.9) {
          pendingOwnerCalRef.current = null;
        }
      }
      return false;
    }
    if (renameId) {
      araRef.current?.cancelResponse();
      const result = executeAllowlistedTool("update_owner_calendar_event", {
        event_id: renameId,
        new_title: title,
        confirm: true,
      }, araDesk(), "owner_session");
      const output = await hydrateAraOutput("update_owner_calendar_event", result);
      utter(String(output.spoken || "I couldn't update that event, so nothing changed."), "TOOL_RESULT");
      return true;
    }
    if (!title && livePending) {
      pendingOwnerCalRef.current = livePending;
      return false;
    }
    araRef.current?.cancelResponse();
    const result = executeAllowlistedTool("create_owner_calendar_event", {
      title,
      when,
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
    }, araDesk(), "owner_session");
    if (!result.ok && result.output.need) {
      pendingOwnerCalRef.current = {
        title: String(result.output.title || title),
        when: String(result.output.when || when),
        need: result.output.need as PendingOwnerCal["need"],
        intent: "create",
        at: Date.now(),
      };
      utter(String(result.output.spoken || result.output.question || "What should I name the call?"), "TOOL_RESULT");
      return true;
    }
    const output = await hydrateAraOutput("create_owner_calendar_event", result);
    if (!output.ok && output.need) {
      pendingOwnerCalRef.current = {
        title: String(output.title || title),
        when: String(output.when || when),
        need: output.need as PendingOwnerCal["need"],
        intent: "create",
        at: Date.now(),
      };
      utter(String(output.spoken || output.question || "What should I name the call?"), "TOOL_RESULT");
      return true;
    }
    utter(String(output.spoken || "I couldn't create that event, so nothing was added."), "TOOL_RESULT");
    return true;
  }

  function stopAra() {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    araGen.current += 1;
    araRef.current?.stop();
    araRef.current = null;
    stopSpeaking();
    araSpeech().stop();
    teardownAraOutput();
    setVoiceListening(false);
    setMicStreamActive(false);
    setAraStatus((s) => (s === "unavailable" || s === "mic_needed" ? s : "ready"));
  }

  async function enableMicrophone() {
    setMicPermission("REQUESTING");
    const hit = await requestMicrophone();
    setMicPermission(hit.state);
    setMicStreamActive(Boolean(hit.stream && hit.state === "GRANTED"));
    if (hit.stream) {
      stopMicStream(micStreamRef.current);
      micStreamRef.current = hit.stream;
    }
    araSpeech().setMic(hit.state, Boolean(hit.stream));
    if (hit.state === "GRANTED") {
      setAraErr("");
      if (voiceMode === "conversation") void startAra();
    } else {
      setAraStatus("mic_needed");
      setAraErr(hit.reason || "Microphone permission is needed to talk to Ara.");
    }
  }

  async function startAra() {
    const gen = araGen.current + 1;
    araGen.current = gen;
    araRef.current?.stop();
    araRef.current = null;
    setAraErr("");
    setVoiceUnavailable(false);
    setAraStatus("connecting");
    unlockAraOutput();
    araSpeech().unlock();
    try {
      if (!liveRef.current.integration) {
        try { await refreshIntegration(); } catch { /* keep UNKNOWN until it arrives */ }
        if (araGen.current !== gen) return;
      }
      let perm = micPermission;
      if (perm === "UNKNOWN" || perm === "REQUESTING" || perm === "GRANTED") {
        setMicPermission("REQUESTING");
        const hit = await requestMicrophone();
        if (araGen.current !== gen) {
          stopMicStream(hit.stream);
          return;
        }
        perm = hit.state;
        setMicPermission(hit.state);
        setMicStreamActive(Boolean(hit.stream));
        araSpeech().setMic(hit.state, Boolean(hit.stream));
        if (hit.stream) {
          stopMicStream(micStreamRef.current);
          micStreamRef.current = hit.stream;
        }
      }
      if (perm !== "GRANTED" || !micStreamRef.current) {
        setAraStatus("mic_needed");
        setVoiceListening(false);
        return;
      }
      const ses = await createAraSessionFn();
      if (araGen.current !== gen) return;
      if (!ses.ok) {
        setAraErr(ses.reason || voiceFailureReason("SESSION_CREATE_FAILED"));
        setVoiceUnavailable(true);
        setAraStatus("unavailable");
        return;
      }
      araSpeech().setSession(true, "ara-session");
      const client = new AraRealtime(ses.token, ses.wsUrl, {
        onStatus: (s) => {
          setAraStatus(s);
          setVoiceListening(s === "listening");
        },
        onMic: (live, reason) => {
          setMicStreamActive(live);
          araSpeech().setMic(live ? "GRANTED" : micPermission, live);
          if (!live) {
            setAraStatus("mic_needed");
            if (reason) setAraErr(reason);
          }
        },
        onUserTranscript: (text, isFinal) => {
          setYouSaid(text);
          youSaidRef.current = text;
          handleAraOwnerTranscript(text, isFinal);
        },
        onAraTranscript: (text) => {
          setVoiceReply(text);
          if (isOwnerCalendarRefusalSpeech(text)) {
            araRef.current?.cancelResponse();
          }
        },
        onToolCall: async (name, args) => {
          if (isClientOwnedStopTool(name)) {
            return { ok: true, ignored: true, cancelled_speech: true, conversation_active: true };
          }
          const result = executeAllowlistedTool(name, args, araDesk(), "owner_session");
          if (result.plan.type === "design") {
            if (FLAGS.DESIGN_DIRECTOR) void applyLocalDesignOps(result.plan.operations, "ARA", result.plan.preview);
            const rec = makeVoiceAudit({
              tool: name,
              prospectUid: liveRef.current.openUid,
              confirmation: null,
              result: result.ok ? "ok" : String(result.output.reason || "rejected"),
            });
            void logVoiceAuditFn({ data: { tool: rec.tool, prospectUid: rec.prospectUid, confirmation: rec.confirmation, result: rec.result } });
            return hydrateAraOutput(name, result);
          }
          const action = planToAction(result.plan);
          if (action) dispatchRef.current(action);
          const uid = planProspectUid(result.plan, liveRef.current.openUid);
          const rec = makeVoiceAudit({
            tool: name,
            prospectUid: uid,
            confirmation: result.plan.type === "arm" ? "pending" : null,
            result: result.ok ? "ok" : String(result.output.reason || "rejected"),
          });
          void logVoiceAuditFn({ data: { tool: rec.tool, prospectUid: rec.prospectUid, confirmation: rec.confirmation, result: rec.result } });
          return hydrateAraOutput(name, result);
        },
        onError: (plain) => {
          if (/microphone|MIC_BLOCKED/i.test(plain || "")) {
            setAraStatus("mic_needed");
            setVoiceListening(false);
            setAraErr(plain || voiceFailureReason("MIC_BLOCKED"));
            return;
          }
          setAraErr(plain || voiceFailureReason("WEBSOCKET_FAILED"));
          setVoiceUnavailable(true);
          setAraStatus("unavailable");
        },
      });
      if (araGen.current !== gen) {
        client.stop();
        return;
      }
      araRef.current = client;
      await client.start(araDesk(), { stream: micStreamRef.current, withMic: true });
      client.setMuted(voiceMuted);
    } catch {
      if (araGen.current !== gen) return;
      setAraErr(voiceFailureReason("SESSION_CREATE_FAILED"));
      setVoiceUnavailable(true);
      setAraStatus("unavailable");
    }
  }

  async function reconnectAraVoice() {
    setVoiceUnavailable(false);
    setAraErr("");
    setAraStatus("connecting");
    unlockAraOutput();
    araSpeech().unlock();
    if (voiceMode === "conversation") {
      void startAra();
      return;
    }
    try {
      const ses = await createAraSessionFn();
      if (!ses.ok) {
        setVoiceUnavailable(true);
        setAraErr(ses.reason || voiceFailureReason("SESSION_CREATE_FAILED"));
        setAraStatus("unavailable");
        return;
      }
      setVoiceUnavailable(false);
      setAraErr("");
      setAraStatus("ready");
    } catch {
      setVoiceUnavailable(true);
      setAraErr(voiceFailureReason("SESSION_CREATE_FAILED"));
      setAraStatus("unavailable");
    }
  }

  function handleAraOwnerTranscript(text: string, isFinal = true) {
    const speaking = araStatus === "speaking";
    const stop = classifyOwnerStopIntent(text, {
      finalized: isFinal,
      araSpeaking: speaking,
      turnId: null,
    });
    if (stop.kind === "stop_conversation") {
      gateRef.current.cancel();
      stopAra();
      setVoiceMode("off");
      setVoiceReply("Okay. Stopped.");
      utter("Okay. Stopped.", "STOP");
      return;
    }
    if (stop.kind === "stop_speech") {
      araSpeech().stop({ keepConversation: true });
      araRef.current?.cancelResponse();
      stopSpeaking();
      return;
    }
    if (stop.kind === "stop_task") {
      gateRef.current.cancel();
      araSpeech().stop({ keepConversation: true });
      stopSpeaking();
      return;
    }
    if (shouldSilenceAraForOwnerCalendar(text, pendingOwnerCalRef.current)
      || (pendingCalManageRef.current && (isOwnerCalendarConfirmYes(text) || isOwnerCalendarConfirmNo(text)))) {
      araRef.current?.cancelResponse();
    }
    if (!isFinal) return;
    if (FLAGS.DESIGN_DIRECTOR && isDesignDirectorUtterance(text)) {
      void runDesignDirector(text);
      return;
    }
    void runOwnerPersonalCalendar(text).then((handled) => {
      if (handled) return;
      const parsed = parseSpokenCommand(text);
      if (parsed.intent === "READ_PAGE" || parsed.intent === "READ_EVERYTHING" || parsed.intent === "READ_WARNING" || parsed.intent === "READ_FORM" || parsed.intent === "READ_OPTIONS") {
        araRef.current?.cancelResponse();
        dispatchRef.current({
          name: parsed.intent === "READ_EVERYTHING" ? "READ_EVERYTHING"
            : parsed.intent === "READ_WARNING" ? "READ_WARNING"
              : parsed.intent === "READ_FORM" ? "READ_FORM"
                : parsed.intent === "READ_OPTIONS" ? "READ_OPTIONS"
                  : "READ_PAGE",
          readMode: parsed.intent === "READ_EVERYTHING" ? "everything"
            : parsed.intent === "READ_WARNING" ? "warning"
              : parsed.intent === "READ_FORM" ? "form"
                : parsed.intent === "READ_OPTIONS" ? "options"
                  : "page",
        });
        return;
      }
      if (confirmSendPhraseOk(text) || confirmSchedulePhraseOk(text) || confirmPhraseOk(text)) {
        runOwnerConfirm(text);
      }
    });
  }

  function runOwnerConfirm(text: string) {
    const pending = gateRef.current.consumeConfirm(liveRef.current.openUid);
    if (!pending.ok) {
      say(pending.expired ? "That confirmation timed out. Say it again if you still want to." : "There’s nothing waiting to confirm.");
      return;
    }
    if (pending.intent === "SEND_EMAIL") {
      if (!confirmSendPhraseOk(text)) {
        say("I need you to say Confirm send, or Cancel. Nothing was sent.");
        const co = findByUid(liveRef.current.rows, pending.target);
        const fp = co?.outreach?.messages.find((m) => m.kind === "email")?.body || "";
        gateRef.current.arm(pending.intent, pending.target, fp);
        return;
      }
      const co = findByUid(liveRef.current.rows, pending.target);
      if (co) void doSend(co, "VOICE");
      void logVoiceAuditFn({ data: { tool: "send_email", prospectUid: pending.target, confirmation: "Confirm send", result: "confirmed" } });
      return;
    }
    if (pending.intent === "SCHEDULE_CALL") {
      if (!confirmSchedulePhraseOk(text)) {
        say("I need you to say Confirm schedule, or Cancel. Nothing was booked.");
        gateRef.current.arm(pending.intent, pending.target);
        return;
      }
      say("Say the time again from the list, then I’ll book it from the buttons. Nothing was booked yet.");
      return;
    }
    if (!confirmPhraseOk(text)) {
      say("I need you to say Confirm, or Cancel.");
      gateRef.current.arm(pending.intent, pending.target);
      return;
    }
    if (pending.intent === "APPROVE_PROSPECT" && pending.target != null) {
      const co = findByUid(liveRef.current.rows, pending.target);
      if (co) approveProspect(co, "VOICE");
      return;
    }
    if (pending.intent === "SKIP_PROSPECT" && pending.target != null) {
      const co = findByUid(liveRef.current.rows, pending.target);
      if (co) skipProspect(co, "VOICE");
      return;
    }
    say("That confirmation doesn’t match. Nothing was changed.");
  }

  useEffect(() => {
    if (voiceMode !== "conversation") {
      stopAra();
      return;
    }
    araReconnects.current = 0;
    void startAra();
    return () => { stopAra(); };
    // Restart only when Talk is toggled — not on every prospect/task render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  useEffect(() => {
    const c = araSpeech();
    c.onCaption = (text) => setVoiceReply(text);
    c.onUnavailable = (v, reason) => {
      setVoiceUnavailable(v);
      if (v && reason) setAraErr(reason);
    };
    c.onSpeaking = (s) => setOutputSpeaking(s);
    return () => {
      c.onCaption = null;
      c.onUnavailable = null;
      c.onSpeaking = null;
    };
  }, []);

  useEffect(() => {
    void queryMicPermission().then((p) => {
      setMicPermission((prev) => (prev === "GRANTED" ? prev : p));
      araSpeech().setMic(p, false);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    void discoveryStatusFn()
      .then((r) => {
        if (r.ok) setDiscoveryConfigured(r.configured);
      })
      .catch(() => setDiscoveryConfigured(false));
  }, [userId]);

  useEffect(() => {
    if (view !== "detail" || !openUid || deepBusy) return;
    const company = findByUid(rows, openUid);
    if (!company?.uid) return;
    if (company.provider !== "google_places") return;
    if (company.research_status !== "queued" && company.research_status !== "none") return;
    if (autoResearchRef.current.has(company.uid)) return;
    autoResearchRef.current.add(company.uid);
    void researchFurther(company.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, openUid]);

  useEffect(() => {
    if (!hydrated) return;
    if (!integration) return;
    const ctx = buildScreenContext(currentDesk(), deskWorld());
    const auto = autoAnnounceFromScreen(ctx);
    if (!auto) return;
    const ev = announceToAra({ type: auto.type, text: auto.text, view, dedupeKey: `${view}:${auto.text}` });
    if (ev) utter(ev.text, announceSource(ev.type), ev.dedupeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, discoveryConfigured, findMsg, googleMissing, hydrated, integration]);

  useEffect(() => {
    const badge = google.gmail;
    const araGmail = integration ? gmailHealth(integration) : google.gmail;
    if (badge === "unknown" || araGmail === "unknown") return;
    if (badge !== araGmail) {
      console.warn("INTEGRATION_STATE_MISMATCH", { badge, ara: araGmail, gmail_connected: integration?.gmail_connected ?? null });
    }
    const world = deskWorld();
    const ctx = buildScreenContext(currentDesk(), world);
    const factSaysMissing = ctx.facts.some((f) => /Gmail isn’t connected/i.test(f.text));
    if (badge === "connected" && factSaysMissing) {
      console.warn("INTEGRATION_STATE_MISMATCH", { badge, fact: "Gmail isn’t connected." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google.gmail, integration, view]);

  useEffect(() => {
    if (voiceMode !== "conversation") return;
    araRef.current?.updateContext(araDesk());
    // Keep Ara's screen context fresh without restarting the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, openUid, view, tasks, google, testModeOn, allowlist, taskIx, sales, testLoop, voiceMode, layout, visual, calView, calAnchor, calEvents, calEventId, integration, googleMissing, lastOwnerEvent]);

  useEffect(() => {
    if (!userId) return;
    void testSettingsFn()
      .then((t) => {
        if (t.ok) {
          if (view !== "settings") {
            setTestModeOn(t.testMode);
            setAllowlist(t.allowlist || []);
          }
          if (t.testLoop) setTestLoop(t.testLoop);
          const integ = (t.integrations || {}) as Record<string, "ready" | "missing" | boolean>;
          const labels: Record<string, string> = {
            googleOAuthClientId: "Google OAuth Client ID",
            googleOAuthClientSecret: "Google OAuth Client Secret",
            appSecret: "APP_SECRET",
          };
          setGoogleMissing(Object.entries(labels).map(([k, name]) => ({
            name,
            ready: integ[k] === "ready" || integ[k] === true,
          })));
          if (t.integration) applyIntegration(t.integration);
        }
      })
      .catch(() => { /* keep last known allowlist */ });
  }, [view, userId]);

  async function askGeneral(query: string) {
    const q = query.trim();
    if (q.length < 2) {
      say("I didn't catch that. Can you say it again?");
      return;
    }
    setVoiceReply("Looking that up…");
    try {
      const r = await araWebResearchFn({ data: { query: q, mode: "quick" } });
      if (r.sources?.length) setAraSources(r.sources);
      if (!r.ok) {
        say(r.reason || "I couldn’t look that up.");
        return;
      }
      say(r.spoken || r.answer);
    } catch {
      say("I couldn’t look that up.");
    }
  }

  function onVoiceTranscript(text: string, isFinal: boolean, confidence: number | undefined) {
    setYouSaid(text);
    if (!isFinal) return;
    if (typeof confidence === "number" && confidence > 0 && confidence < 0.4) {
      say("I didn't catch that. Can you say it again?");
      return;
    }
    const speaking = araStatus === "speaking";
    const stop = classifyOwnerStopIntent(text, { finalized: true, araSpeaking: speaking });
    if (stop.kind === "stop_conversation") {
      gateRef.current.cancel();
      stopSpeaking();
      setVoiceMode("off");
      setVoiceReply("Okay. Stopped.");
      utter("Okay. Stopped.", "STOP");
      return;
    }
    if (stop.kind === "stop_speech") {
      stopSpeaking();
      return;
    }
    if (stop.kind === "stop_task") {
      gateRef.current.cancel();
      stopSpeaking();
      return;
    }
    if (pendingCalManageRef.current && (isOwnerCalendarConfirmYes(text) || isOwnerCalendarConfirmNo(text))) {
      void runOwnerPersonalCalendar(text);
      return;
    }
    if (confirmSendPhraseOk(text) || confirmSchedulePhraseOk(text) || confirmPhraseOk(text)) {
      runOwnerConfirm(text);
      return;
    }
    if (FLAGS.DESIGN_DIRECTOR && isDesignDirectorUtterance(text)) {
      void runDesignDirector(text);
      return;
    }
    void runOwnerPersonalCalendar(text).then((handled) => {
      if (handled) return;
      const decided = spokenToAction(text, currentDesk(), deskWorld());
      if ("ask" in decided) {
        say(decided.ask);
        return;
      }
      if ("action" in decided) {
        const id = makeActionId(decided.action.name, decided.action.uid || openUid, text);
        if (gateRef.current.seen(id)) return;
        if (decided.action.name === "STOP_LISTENING") {
          gateRef.current.cancel();
          stopSpeaking();
          setVoiceMode("off");
          setVoiceReply("Okay. Stopped.");
          utter("Okay. Stopped.", "STOP");
          return;
        }
        if (decided.action.name === "NAVIGATE_CALENDAR" && !isExplicitCalendarNavigate(text)) {
          return;
        }
        dispatchAction(decided.action);
        return;
      }
      void askGeneral(text);
    });
  }

  function approveProspect(open: Prospect, method: "MANUAL" | "VOICE") {
    const pack = generateOutreach(open);
    patchCompany({
      ...open,
      stage: "Approved for Outreach",
      stage_plain: STAGE["Approved for Outreach"],
      outreach: pack,
      history: [...(open.history || []), { at: new Date().toISOString(), action: "approved_prospect", detail: `Approved for outreach (${method})` }],
    });
    setOpenUid(open.uid || null);
    setView("outreach");
    if (method === "VOICE") say(`Approved ${open.name}. Your message is ready. Nothing was sent.`);
  }

  async function doSend(open: Prospect, method: "MANUAL" | "VOICE") {
    if (!open.uid) {
      say("This company is missing an id. Nothing was sent.");
      return;
    }
    try {
      const result = await sendFirstEmailFn({ data: { uid: open.uid, method, approveSequence: false } });
      if (!result.ok) {
        setSyncErr(result.reason);
        if (method === "VOICE") say(result.reason);
        return;
      }
      patchCompany({
        ...open,
        stage: "Contacted",
        stage_plain: "You already reached out",
        outreach: open.outreach
          ? { ...open.outreach, messages: open.outreach.messages.map((m) => m.kind === "email" ? { ...m, state: "SENT" } : m) }
          : open.outreach,
        history: [...(open.history || []), { at: new Date().toISOString(), action: "sent", detail: `Gmail confirmed send (${method})` }],
      });
      if (method === "VOICE") say(`Sent to ${open.name}.`);
    } catch {
      setSyncErr("Lamb Ascension could not send this email. It has NOT been marked sent.");
      if (method === "VOICE") say("Could not send. It has not been marked sent.");
    }
  }

  function skipProspect(open: Prospect, method: "MANUAL" | "VOICE") {
    patchCompany({
      ...open,
      stage: "Do Not Contact",
      stage_plain: STAGE["Do Not Contact"],
      suppressed: true,
      history: [...(open.history || []), { at: new Date().toISOString(), action: "skip", detail: `Do Not Contact (${method})` }],
    });
    setView("home");
    if (open.uid) void stopSequenceFn({ data: { uid: open.uid } });
    if (method === "VOICE") say(`${open.name} is on Do Not Contact.`);
  }

  async function researchFurther(uid: string) {
    const company = findByUid(rows, uid);
    if (!company) return;
    setDeepBusy(true);
    setDeepErr("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      let used = { day: today, n: 0 };
      try {
        const raw = localStorage.getItem(USAGE);
        if (raw) used = JSON.parse(raw) as { day: string; n: number };
      } catch { /* ignore */ }
      if (used.day !== today) used = { day: today, n: 0 };
      const result = await deepResearchFn({
        data: {
          name: company.name,
          website: company.website,
          vertical: company.vertical,
          city: company.city,
          phone: company.phone,
          google_rating: company.google_rating,
          review_count: company.review_count,
          locations_count: company.locations_count,
          years_in_business: company.years_in_business,
          score: company.score,
          research_status: company.research_status,
          findings: company.findings,
        },
      });
      if (result.hunter_ran) {
        used.n += 1;
        localStorage.setItem(USAGE, JSON.stringify(used));
      }
      const contacts = mergeContacts(company.contacts, result.contacts || []);
      const siteOk = (result.facts || []).some((f) => f.key === "website" && f.status === "VERIFIED");
      const foundContact = contacts.some((x) => (x.name && x.name !== "UNKNOWN") || (x.email && x.email.includes("@")));
      const nextStatus = nextResearchStatus(company.research_status, { siteOk, foundContact });
      setRows((prev) => applyByUid(prev, uid, (c) => {
        const keep = new Set(["provider", "place_id", "maps_url", "address", "category", "business_status", "coordinates", "job_value_est"]);
        const preserved = (c.facts || []).filter((f) => keep.has(f.key) && !(result.facts || []).some((r) => r.key === f.key));
        return {
          ...c,
          facts: [...preserved, ...result.facts],
          contacts: mergeContacts(c.contacts, result.contacts || []),
          ads: result.ads,
          socials: result.socials,
          readiness: result.readiness,
          readiness_why: result.readiness_why,
          company_kind: result.company_kind,
          website_note: result.website_note,
          hunter_skipped_reason: result.hunter_skipped_reason,
          deep_at: new Date().toISOString(),
          estimated_cents: result.estimated_cents,
          pages_fetched: result.pages_fetched,
          research_status: nextResearchStatus(c.research_status, { siteOk, foundContact }),
          findings: (result.findings && result.findings.length) ? result.findings : c.findings,
        };
      }));
      const preview = { ...company, contacts, research_status: nextStatus };
      if (reachKind(preview) === "READY_TO_CONTACT") {
        say(`Ready to contact ${company.name}. ${araRecommend(preview)}`);
      } else {
        say(`I still don’t have a useful decision-maker for ${company.name}. You can open the website, call the listing number if we have one, or skip. I did not invent an email.`);
      }
    } catch {
      setDeepErr("Deep research didn’t finish. We did not invent contacts or ads. Press Try again, or Skip.");
    } finally {
      setDeepBusy(false);
    }
  }

  async function runFind(opts?: { vertical?: string; location?: string; limit?: number }) {
    const v = opts?.vertical || vert;
    const loc = opts?.location || city;
    const n = opts?.limit || findLimit;
    setFindBusy(true);
    setFindMsg("");
    try {
      const result = await findClientsFn({
        data: {
          vertical: v,
          location: loc,
          limit: n,
          radiusM: Math.round(radiusMiles * 1609.34),
          minRating,
          minReviews,
        },
      });
      if (!result.ok) {
        setFindMsg(result.reason);
        say(result.reason);
        return;
      }
      setRows(result.prospects);
      saveCompanies(result.prospects);
      if (result.lastDiscovery) {
        setLastDiscovery(result.lastDiscovery);
        saveLastDiscovery(result.lastDiscovery);
        setProspectFilter({
          lastDiscovery: true,
          prospectUids: result.lastDiscovery.prospectUids,
        });
      }
      setFindMsg(result.reason);
      setView("pipe");
      say(result.reason);
    } catch {
      const msg = "Lamb Ascension couldn’t save this change to the server. Your local copy is still safe.";
      setFindMsg(msg);
      setSyncErr(msg);
    } finally {
      setFindBusy(false);
    }
  }

  function addClient(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("I need the company name. Type it, then Save."); return; }
    const created = ensureUid({
      id: nextClientId(rows),
      uid: newUid(),
      name: name.trim(), vertical: vert, city, website: web, review_count: 0, google_rating: "UNKNOWN",
      phone: "UNKNOWN", job_value_est: 0, job_value_kind: "UNKNOWN", score: 45, fit: "possible", fit_plain: FIT.possible,
      stage: "New", stage_plain: STAGE.New, research_status: web ? "queued" : "none", findings: [],
    });
    setRows((prev) => [...prev, created]);
    setName(""); setWeb(""); setView("home");
  }

  const open = findByUid(rows, openUid);

  if (isPending) {
    return null;
  }

  if (!user) {
    return (
      <main className="la-login la-shell" data-la-app="lamb-ascension" data-la-signin="1">
        <form onSubmit={signIn} className="la-card">
          <p className="la-kicker">Lamb Ascension</p>
          <h1 className="font-display mt-2 mb-2 text-3xl">Sign in</h1>
          <p className="mb-6 text-sm text-muted">This is your agency desk. You'll only see what needs you.</p>
          <label className="la-label" htmlFor="em">Email</label>
          <input id="em" className="la-field mb-3" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <label className="la-label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="la-field mb-5" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="la-btn la-btn-primary" disabled={busy}>
              {busy ? "Signing in…" : "Enter"}
            </button>
            <button type="button" className="la-btn la-btn-ghost" onClick={() => setExplain("Sign in with the owner email and password. This desk does not create accounts from the browser. Wrong details show the same message — we do not reveal whether an email exists.")}>
              Explain this
            </button>
          </div>
          {err ? <div className="la-ribbon la-ribbon-bad mt-4">{err}</div> : null}
        </form>
        {explain ? <ExplainPanel text={explain} onClose={() => setExplain(null)} /> : null}
      </main>
    );
  }

  const upNext = tasks[taskIx ?? 0] || tasks[0] || null;
  const attentionN = tasks.filter((t) => t.severity === "red").length;
  const greeting = timeGreeting();
  const wide = view === "pipe" || view === "calendar";

  function renderHomeWidget(id: HomeWidget) {
    const big = layout.emphasis === id;
    if (id === "greeting") {
      return (
        <section key={id} data-home-widget="greeting" className="mb-5">
          <p className="la-kicker">Owner Mode</p>
          <h1 className="font-display mt-2 text-[2.15rem] leading-[1.12] sm:text-4xl">{greeting}</h1>
          <p className="la-lede">Here’s what needs you today.</p>
        </section>
      );
    }
    if (id === "hero") {
      return (
        <section key={id} data-home-widget="hero" className="mb-6">
          <button
            className={big ? "la-hero" : "la-btn la-btn-primary w-full min-h-12"}
            onClick={() => dispatchAction({ name: "START_TASKS" })}
          >
            Start My Tasks
            <ArrowRight size={18} strokeWidth={2.2} />
          </button>
          <div className="la-hero-row">
            <button className="la-btn la-btn-ghost" onClick={() => dispatchAction({ name: "OPEN_FIND_CLIENTS" })}>
              <Search size={16} strokeWidth={2} />
              Find Clients
            </button>
            <button className="la-btn la-btn-ghost" onClick={() => dispatchAction({ name: "EXPLAIN", showPanel: true })}>Explain this</button>
          </div>
        </section>
      );
    }
    if (id === "status") {
      return (
        <div key={id} data-home-widget="status" className="la-stats mb-6">
          <div className="la-stat"><b>{readyN}</b><span>prospect{readyN === 1 ? "" : "s"} ready</span></div>
          <div className="la-stat"><b>{attentionN}</b><span>issue{attentionN === 1 ? "" : "s"} need attention</span></div>
          <div className="la-stat"><b>{sales.replies}</b><span>{sales.replies === 1 ? "reply" : "replies"} waiting</span></div>
          <div className="la-stat"><b>{sales.calls}</b><span>{sales.calls === 1 ? "call" : "calls"} today</span></div>
        </div>
      );
    }
    if (id === "up_next" && upNext) {
      const company = upNext.company_uid ? findByUid(rows, upNext.company_uid) : null;
      if (company) {
        return (
          <section key={id} data-home-widget="up_next" className="la-card la-card-accent mb-6">
            <ProspectReachCard
              company={company}
              heading="Up next"
              gmailConnected={google.gmail === "connected"}
              busy={deepBusy}
              onAction={(action) => runProspectAction(company.uid, action)}
            />
            {deepErr ? <div className="la-ribbon la-ribbon-bad mt-3">{deepErr}</div> : null}
            <p className="mt-3 text-xs text-muted">{Math.min((taskIx ?? 0) + 1, tasks.length)} of {tasks.length} tasks</p>
          </section>
        );
      }
      return (
        <section key={id} data-home-widget="up_next" className="la-card la-card-accent mb-6">
          <p className="la-kicker">Up next</p>
          <h2 className="font-display mt-2 text-2xl leading-tight">{upNext.title}</h2>
          <p className="mt-2 text-sm">{upNext.plain}</p>
          <p className="mt-1 text-sm text-muted">{upNext.why}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="la-btn la-btn-primary" onClick={() => runTask(upNext)}>{upNext.button}</button>
            <button className="la-btn la-btn-ghost" onClick={() => dispatchAction({ name: "SKIP_CURRENT_TASK", uid: upNext.company_uid })}>Skip</button>
          </div>
          <p className="mt-3 text-xs text-muted">{Math.min((taskIx ?? 0) + 1, tasks.length)} of {tasks.length} tasks</p>
        </section>
      );
    }
    if (id === "needs_you") {
      const rest = tasks.slice(upNext ? 1 : 0, 6);
      return (
        <section key={id} data-home-widget="needs_you" className="la-card mb-6">
          <h3 className="font-display mb-1 text-lg">Needs you</h3>
          {rest.map((t) => (
            <div key={t.id} className="la-list-row">
              <div className="min-w-0">
                <b className="la-list-name">{t.title}</b>
                <div className="text-sm text-muted">{t.plain}</div>
              </div>
              <button className="la-btn la-btn-ghost shrink-0" onClick={() => runTask(t)}>{t.button}</button>
            </div>
          ))}
          {!rest.length ? <p className="la-empty">Nothing else in line.</p> : null}
        </section>
      );
    }
    if (id === "sales") {
      return (
        <p key={id} data-home-widget="sales" className="mb-6 text-sm text-muted">
          Sales · {sales.ready} ready · {sales.followups} follow-ups · {sales.replies} replies · {sales.calls} calls
        </p>
      );
    }
    if (id === "connections") {
      return (
        <section key={id} data-home-widget="connections" className="la-card mb-6">
          <h2 className="font-display text-xl">Connections</h2>
          <p className="mt-2 text-sm"><span className={`la-dot la-dot-inline ${healthClass(google.gmail)}`} />{google.gmail === "connected" ? `Gmail connected${google.gmailEmail ? ` · ${google.gmailEmail}` : ""}` : google.gmail === "attention" ? "Gmail needs attention" : google.gmail === "unknown" ? "Checking Gmail…" : "Gmail not connected"}</p>
          <p className="text-sm"><span className={`la-dot la-dot-inline ${healthClass(google.calendar)}`} />{google.calendar === "connected" ? `Calendar connected${google.calendarEmail ? ` · ${google.calendarEmail}` : ""}` : google.calendar === "attention" ? "Calendar needs attention" : google.calendar === "unknown" ? "Checking Calendar…" : "Calendar not connected"}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="la-btn la-btn-primary" onClick={() => void connectGoogle("gmail")}>Connect Gmail</button>
            <button type="button" className="la-btn la-btn-ghost" onClick={() => void connectGoogle("calendar")}>Connect Google Calendar</button>
          </div>
          {googleErr ? (
            <div className="la-ribbon la-ribbon-bad mt-3">
              <span>{googleErr}</span>
              {googleMissing.length ? (
                <span className="block w-full">
                  {googleMissing.map((m) => `${m.name} — ${m.ready ? "Ready" : "Missing"}`).join(" · ")}
                </span>
              ) : null}
              {googleNext ? <span className="block w-full">{googleNext}</span> : null}
              {googleUrl ? (
                <a className="mt-2 inline-block underline" href={googleUrl} target="_blank" rel="noreferrer">Continue with Google</a>
              ) : null}
            </div>
          ) : null}
          {googleMsg ? <div className="la-ribbon la-ribbon-good mt-3">{googleMsg}</div> : null}
        </section>
      );
    }
    if (id === "pipeline") {
      return (
        <section key={id} data-home-widget="pipeline" className="la-card mb-6">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-display text-lg">Pipeline</h3>
            <button className="la-btn la-btn-quiet" onClick={() => dispatchAction({ name: "NAVIGATE_PIPELINE" })}>Open</button>
          </div>
          {rows.slice(0, 4).map((c) => (
            <button key={c.uid || c.id} className="la-list-row" onClick={() => dispatchAction({ name: "OPEN_PROSPECT", uid: c.uid })}>
              <span className="la-list-name"><b>{c.name}</b></span>
              <span className="text-sm text-muted">{c.stage_plain}</span>
            </button>
          ))}
        </section>
      );
    }
    return null;
  }

  return (
    <div
      className="la-shell"
      data-la-app="lamb-ascension"
      data-shared-screen="1"
      data-visual={view === "home" && visibleBackgroundUrl(visual, adultUnlocked) ? "1" : "0"}
      data-glass={view === "home" && visual.home.cardGlass ? "1" : "0"}
      data-density={visual.home.density}
      data-vp={viewport}
      data-main-width={chrome.mainWidth}
      data-widget-size-hero={chrome.widgetSize.hero || ""}
      data-widget-size-up_next={chrome.widgetSize.up_next || ""}
      data-widget-size-sales={chrome.widgetSize.sales || ""}
      data-widget-size-needs_you={chrome.widgetSize.needs_you || ""}
      data-widget-size-status={chrome.widgetSize.status || ""}
      style={view === "home" ? { ...visualCssVars(visual.home), ...designCssVars(chrome) } : undefined}
    >
      {view === "home" && visibleBackgroundUrl(visual, adultUnlocked) ? (
        <div className="la-scene" aria-hidden>
          <div className="la-scene-veil" />
        </div>
      ) : null}
      <input
        ref={filePickRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importPickedFile(file, pickNsfwRef.current);
        }}
      />
      <header className="la-top">
        <div className="la-top-inner">
          <div className="la-brand">
            <div className="la-mark">LA</div>
            <div>
              <div className="la-brand-name">Lamb Ascension</div>
              <div className="la-brand-meta">
                <span>Owner Mode</span>
                {testModeOn ? <span className="la-chip">TEST MODE</span> : null}
                <span className="la-chip"><span className={`la-dot ${healthClass(google.gmail)}`} />Gmail</span>
                <span className="la-chip"><span className={`la-dot ${healthClass(google.calendar)}`} />Calendar</span>
              </div>
            </div>
          </div>
          <nav className="la-nav">
            <button className="la-nav-btn la-nav-quiet" data-on={view === "home" ? "1" : "0"} onClick={() => dispatchAction({ name: "NAVIGATE_HOME" })}>Home</button>
            <button className="la-nav-btn la-nav-quiet" data-on={view === "add" ? "1" : "0"} onClick={() => dispatchAction({ name: "OPEN_ADD_CLIENT" })}>Add Client</button>
            <button className="la-nav-btn la-nav-quiet" data-on={view === "pipe" ? "1" : "0"} onClick={() => dispatchAction({ name: "NAVIGATE_PIPELINE" })}>Pipeline</button>
            <button className="la-nav-btn la-nav-quiet" data-on={view === "calendar" ? "1" : "0"} onClick={() => dispatchAction({ name: "NAVIGATE_CALENDAR" })}>Calendar</button>
            <button className="la-nav-btn la-nav-quiet" data-on={view === "settings" ? "1" : "0"} onClick={() => dispatchAction({ name: "NAVIGATE_SETTINGS" })}>Settings</button>
            <button
              className="la-nav-btn"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void realSignOut().catch(() => setBusy(false));
              }}
            >
              Sign out
            </button>
          </nav>
        </div>
        <div className="la-ara-slot">
          <VoiceBar
            mode={voiceMode}
            onMode={(m) => {
              setVoiceMode(m);
              if (m === "off") {
                stopAra();
                stopSpeaking();
                araSpeech().stop();
                gateRef.current.cancel();
              }
            }}
            listening={voiceMode === "ptt" ? voiceListening : false}
            you={youSaid}
            reply={voiceReply}
            muted={voiceMuted}
            onMuted={(v) => {
              setVoiceMuted(v);
              araRef.current?.setMuted(v);
              araSpeech().setMuted(v);
            }}
            onTranscript={onVoiceTranscript}
            onListening={setVoiceListening}
            onStop={() => {
              stopAra();
              setVoiceMode("off");
              setVoiceListening(false);
              stopSpeaking();
              araSpeech().stop();
              gateRef.current.cancel();
              setVoiceReply("Okay. Stopped.");
              utter("Okay. Stopped.", "STOP");
            }}
            araStatus={araStatus}
            araError={araErr}
            micPermission={micPermission}
            micStreamActive={micStreamActive}
            voiceSessionReady={araStatus === "listening" || araStatus === "speaking" || Boolean(araRef.current)}
            voiceUnavailable={voiceUnavailable}
            outputSpeaking={outputSpeaking || araStatus === "speaking"}
            onEnableMic={() => { void enableMicrophone(); }}
            onReconnectVoice={() => { void reconnectAraVoice(); }}
            onReadPage={() => {
              const brief = buildScreenContext(currentDesk(), deskWorld());
              const text = readScreen(brief, "page");
              utter(text, "SCREEN_READER", `read:page:${brief.screen}`);
            }}
          />
          {FLAGS.DESIGN_DIRECTOR ? (
          <DesignDirectorBar
            status={ddStatus}
            paused={ddPaused}
            spoken={ddSpoken}
            preview={ddPreview}
            busy={ddBusy}
            onSend={(prompt) => void runDesignDirector(prompt)}
            onPause={(paused) => {
              setDdPaused(paused);
              setDdStatus(paused ? "paused" : ddStatus === "disconnected" ? "disconnected" : "connected");
              void setDesignDirectorPausedFn({ data: { paused } })
                .then((r) => {
                  if (r.ok) {
                    setDdPaused(r.paused);
                    setDdStatus(r.status);
                    setDdSpoken(r.paused ? "Design Director paused. Suggestions only." : "Design Director resumed.");
                  }
                })
                .catch(() => { /* local pause already applied */ });
            }}
            onUndo={() => void applyLocalDesignOps([{ op: "undo_design_change" }], "DYLAN")}
            onKeep={() => void keepDesign()}
            onDiscard={() => void discardDesign()}
            onTryAnother={tryAnotherDesign}
            onOpenSettings={() => dispatchAction({ name: "NAVIGATE_SETTINGS" })}
          />
          ) : null}
        </div>
      </header>
      <main
        className={`la-main ${wide ? "la-main-wide" : ""}`}
        data-owner-view={view}
        data-open-uid={openUid || ""}
        data-company-name={open?.name || ""}
        data-evidence={evidence ? "1" : "0"}
        data-home-order={visibleOrder(layout).join(",")}
      >
        {syncErr ? <div className="la-ribbon la-ribbon-bad mb-3">{syncErr}</div> : null}
        {testModeOn ? (
          <div className="la-quiet-line mb-3">
            <button type="button" className="la-quiet-status" onClick={() => setTestOpen((v) => !v)}>
              TEST MODE · Email restricted to test allowlist
            </button>
            {testOpen ? (
              <div className="la-ribbon la-ribbon-test mt-2">
                Emails can only go to addresses you add in Settings. Daily test cap: 2 first emails, 3 follow-ups.
                <button className="la-btn la-btn-quiet" onClick={() => dispatchAction({ name: "NAVIGATE_SETTINGS" })}>Open Settings</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {nextCall && view === "home" ? (
          <div className="la-ribbon la-ribbon-call mb-3">
            <b>Next sales call:</b> {new Date(nextCall.start_at).toLocaleString()} — {rows.find((p) => p.uid === nextCall.prospect_uid)?.name || nextCall.title}
            <button className="la-btn la-btn-quiet" onClick={() => dispatchAction({ name: "NAVIGATE_CALENDAR" })}>Open Calendar</button>
          </div>
        ) : null}
        {view === "settings" ? (
          <TestDesk
            onBack={() => setView("home")}
            onTestModeChange={(on, list) => {
              setTestModeOn(on);
              setAllowlist(list);
            }}
            onIntegration={applyIntegration}
            onTestLoop={setTestLoop}
          />
        ) : null}
        {view === "home" ? (
          <>
            {nsfwLocked(visual, adultUnlocked) ? (
              <div className="la-scene-lock la-card">
                <p className="text-sm">Adult background is hidden until you unlock it.</p>
                <button type="button" className="la-btn la-btn-primary" onClick={() => setAdultUnlocked(true)}>Show adult background</button>
              </div>
            ) : null}
            <button
              type="button"
              className={`la-quiet-status mb-5 ${light === "red" ? "is-bad" : light === "yellow" ? "is-warn" : "is-good"}`}
              onClick={() => setStatusOpen((v) => !v)}
            >
              <span className={`la-dot ${light === "red" ? "la-dot-bad" : light === "yellow" ? "la-dot-warn" : "la-dot-good"}`} />
              {light === "green"
                ? "Everything is good"
                : `${attentionN} issue${attentionN === 1 ? "" : "s"} need attention`}
            </button>
            {statusOpen && light !== "green" ? (
              <div className={`la-attention mb-5 ${light === "red" ? "la-attention-red" : "la-attention-yellow"}`}>
                <div>
                  <b>{headline}</b>
                  <p>{blurb}</p>
                </div>
              </div>
            ) : null}
            {visibleOrder(layout).map((id) => renderHomeWidget(id))}
            <ImageDock
              gallery={gallery}
              compact
              onToggle={() => setGallery((g) => ({ ...g, libraryOpen: !g.libraryOpen }))}
              onSelect={(id) => dispatchAction({ name: "IMAGE", image: { op: "select", id } })}
              onUseHome={(id) => dispatchAction({ name: "IMAGE", image: { op: "as_background", id } })}
              onDelete={(id) => dispatchAction({ name: "IMAGE", image: { op: "delete", id } })}
            />
          </>
        ) : null}

        {view === "find" ? (
          <form
            className="la-card"
            onSubmit={(e) => { e.preventDefault(); void runFind(); }}
          >
            <p className="la-kicker">Acquisition</p>
            <h2 className="font-display mt-2 text-2xl">Find Clients</h2>
            <p className="mb-4 mt-1 text-sm text-muted">We’ll look up real companies. We will not invent names.</p>
            {discoveryConfigured === false ? (
              <div className="la-ribbon la-ribbon-bad mb-4">
                Live Find Clients is off because Google Places is not configured. Add GOOGLE_PLACES_API_KEY on the server, and enable Places API (New) plus Geocoding API. We will not invent businesses. You can still add a company you already know.
              </div>
            ) : null}
            <label className="la-label">What kind of company?</label>
            <input
              className="la-field mb-3"
              list="la-verticals"
              value={vert}
              onChange={(e) => setVert(e.target.value)}
              placeholder="Roofing companies, cosmetic dentists, …"
            />
            <datalist id="la-verticals">
              {["Roofing", "HVAC", "Plumbing / sewer", "Foundation repair", "Solar", "Med spa / cosmetic", "Dental", "Law / personal injury", "B2B consulting", "SaaS / software"].map((x) => <option key={x} value={x} />)}
            </datalist>
            <label className="la-label">Where?</label>
            <input className="la-field mb-3" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Fort Worth, Texas" />
            <label className="la-label">How many?</label>
            <input className="la-field mb-3" type="number" min={1} max={20} value={findLimit} onChange={(e) => setFindLimit(Number(e.target.value) || 8)} />
            <button type="button" className="la-btn la-btn-quiet mb-3" onClick={() => setFindMore((v) => !v)}>{findMore ? "Hide extra filters" : "More"}</button>
            {findMore ? (
              <div className="mb-3 grid gap-2">
                <label className="text-sm text-muted">Search radius (miles) <input className="la-field ml-2 inline-block w-24" type="number" min={1} max={50} value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value) || 25)} /></label>
                <label className="text-sm text-muted">Minimum rating <input className="la-field ml-2 inline-block w-24" type="number" min={0} max={5} step={0.5} value={minRating} onChange={(e) => setMinRating(Number(e.target.value) || 0)} /></label>
                <label className="text-sm text-muted">Minimum reviews (optional, not a gate) <input className="la-field ml-2 inline-block w-24" type="number" min={0} value={minReviews} onChange={(e) => setMinReviews(Number(e.target.value) || 0)} /></label>
              </div>
            ) : null}
            {findMsg ? <p className="mb-3 text-sm">{findMsg}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button className="la-btn la-btn-primary" type="submit" disabled={findBusy || discoveryConfigured === false}>
                {findBusy ? "Looking…" : "Find Clients"}
              </button>
              <button className="la-btn la-btn-ghost" type="button" onClick={() => setView("add")}>Add one I already know</button>
              <button className="la-btn la-btn-ghost" type="button" onClick={() => setView("home")}>Cancel</button>
            </div>
          </form>
        ) : null}

        {view === "add" ? (
          <form onSubmit={addClient} className="la-card">
            <p className="la-kicker">Acquisition</p>
            <h2 className="font-display mt-2 text-2xl">Add Client</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Use this when you already know the company.</p>
            <label className="la-label">Company name</label>
            <input className="la-field mb-3" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="la-label">What they do</label>
            <select className="la-field mb-3" value={vert} onChange={(e) => setVert(e.target.value)}>
              {["Roofing", "HVAC", "Plumbing / sewer", "Foundation repair", "Solar", "Med spa / cosmetic", "Dental", "Law / personal injury", "B2B consulting", "SaaS / software", "Other"].map((x) => <option key={x}>{x}</option>)}
            </select>
            <label className="la-label">Website</label>
            <input className="la-field mb-3" value={web} onChange={(e) => setWeb(e.target.value)} placeholder="https://" />
            <label className="la-label">City</label>
            <input className="la-field mb-4" value={city} onChange={(e) => setCity(e.target.value)} />
            {err ? <p className="mb-3 text-sm text-bad">{err}</p> : null}
            <div className="flex gap-2">
              <button className="la-btn la-btn-primary" type="submit">Save</button>
              <button className="la-btn la-btn-ghost" type="button" onClick={() => setView("home")}>Cancel</button>
            </div>
          </form>
        ) : null}

        {view === "pipe" ? (
          <section className="la-card">
            <p className="la-kicker">Pipeline</p>
            <h2 className="font-display mb-2 mt-2 text-2xl">Pipeline</h2>
            <p className="mb-3 text-sm text-muted">{filterSummary(visibleRows.length, prospectFilter, lastDiscovery)}</p>
            {!isFilterEmpty(prospectFilter) ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {filterChips(prospectFilter, lastDiscovery).map((chip) => (
                  <span key={chip} className="la-chip">{chip}</span>
                ))}
                <button
                  type="button"
                  className="la-btn la-btn-quiet"
                  onClick={() => dispatchAction({ name: "FILTER_PROSPECTS", filter: { replace: true } })}
                >
                  Clear filters
                </button>
              </div>
            ) : null}
            {visibleRows.length ? visibleRows.map((c) => {
              const full = rows.find((r) => r.uid === c.uid);
              if (!full) return null;
              return (
                <button key={c.uid || full.id} className="la-list-row" onClick={() => dispatchAction({ name: "OPEN_PROSPECT", uid: c.uid })}>
                  <span>
                    <b className="la-list-name">{c.name}</b>
                    <span className="mt-0.5 block text-sm text-muted">{c.fitHeadline} · {reachLabel(c.reach)} · {full.stage_plain}</span>
                  </span>
                </button>
              );
            }) : <p className="la-empty">{rows.length ? "Nothing matches these filters." : "No companies yet. Find Clients or add one you already know."}</p>}
          </section>
        ) : null}

        {view === "calendar" ? (
          <CalendarDesk
            calView={calView}
            calAnchor={calAnchor}
            events={calEvents}
            selectedId={calEventId}
            health={integration ? calendarHealth(integration) : google.calendar}
            reason={calReason}
            loading={calLoading}
            onToday={() => dispatchAction({ name: "CALENDAR_TODAY" })}
            onPrev={() => dispatchAction({ name: "CALENDAR_PREV" })}
            onNext={() => dispatchAction({ name: "CALENDAR_NEXT" })}
            onView={(v) => dispatchAction({ name: "CALENDAR_SET_VIEW", calendarView: v })}
            onSelect={(id) => dispatchAction({ name: "OPEN_CALENDAR_EVENT", eventId: id })}
            onOpenProspect={(uid) => dispatchAction({ name: "OPEN_PROSPECT", uid })}
            onPrep={(uid) => dispatchAction({ name: "READ_CALL_OPENER", uid })}
            onSettings={() => dispatchAction({ name: "NAVIGATE_SETTINGS" })}
          />
        ) : null}

        {view === "outreach" && open ? (
          <OutreachDesk
            company={open}
            onSave={patchCompany}
            onExplain={() => dispatchAction({ name: "EXPLAIN", uid: open.uid, showPanel: true })}
            onBack={() => dispatchAction({ name: "GO_BACK" })}
            onCall={() => setView("call")}
            onPrep={() => setView("prep")}
            onSend={() => void doSend(open, "MANUAL")}
            gmailConnected={google.gmail === "connected"}
          />
        ) : null}
        {view === "call" && open ? <CallCard company={open} onBack={() => setView("outreach")} /> : null}
        {view === "prep" && open ? (
          <PrepCard company={open} onSave={patchCompany} onBack={() => setView("home")} />
        ) : null}
        {view === "detail" && open ? (
          <ReviewPage
            company={open}
            evidence={evidence}
            advanced={advanced}
            busy={deepBusy}
            err={deepErr}
            gmailConnected={google.gmail === "connected"}
            upcomingCall={prospectCall && prospectCall.prospectUid === open.uid ? prospectCall : null}
            rescheduleDraft={rescheduleDraft}
            callActionMsg={callActionMsg}
            onEvidence={() => {
              if (evidence) setEvidence(false);
              else dispatchAction({ name: "SHOW_EVIDENCE", uid: open.uid });
            }}
            onAdvanced={() => setAdvanced((v) => !v)}
            onExplain={() => dispatchAction({ name: "EXPLAIN", uid: open.uid, showPanel: true })}
            onApprove={() => approveProspect(open, "MANUAL")}
            onSkip={() => skipProspect(open, "MANUAL")}
            onResearch={() => researchFurther(open.uid || "")}
            onAction={(id) => runProspectAction(open.uid, id)}
            onBack={() => dispatchAction({ name: "GO_BACK" })}
            onOpenCalendar={openProspectCallCalendar}
            onRescheduleDraft={setRescheduleDraft}
            onReschedule={() => void rescheduleProspectCall()}
            onCancelCall={() => void cancelProspectCall()}
          />
        ) : null}
        {view !== "home" ? (
          <ImageDock
            gallery={gallery}
            onToggle={() => setGallery((g) => ({ ...g, libraryOpen: !g.libraryOpen }))}
            onSelect={(id) => dispatchAction({ name: "IMAGE", image: { op: "select", id } })}
            onUseHome={(id) => dispatchAction({ name: "IMAGE", image: { op: "as_background", id } })}
            onDelete={(id) => dispatchAction({ name: "IMAGE", image: { op: "delete", id } })}
          />
        ) : null}
      </main>
      {view === "home" ? (
        <section className="la-scenery" data-scenery-view="1" aria-label="Scenery view">
          <button
            type="button"
            className="la-scenery-top"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            ↑ Back to top
          </button>
        </section>
      ) : null}

      {taskIx !== null && tasks[taskIx] ? (
        <Sheet
          title={`Task ${taskIx + 1} of ${tasks.length}`}
          heading={tasks[taskIx].title}
          text={`What happened: ${tasks[taskIx].plain}\n\nWhy it matters: ${tasks[taskIx].why}\n\nWhat I recommend: ${tasks[taskIx].recommend}`}
          onClose={() => dispatchAction({ name: "ACKNOWLEDGE_TASK" })}
        >
          <button className="la-btn la-btn-primary" onClick={() => dispatchAction({ name: "REVIEW_CURRENT_TASK", uid: tasks[taskIx].company_uid })}>
            Learn More
          </button>
          {tasks[taskIx].retry ? (
            <button className="la-btn la-btn-ghost" onClick={() => dispatchAction({ name: "FIND_CONTACT", uid: tasks[taskIx].company_uid })}>Find Contact</button>
          ) : null}
          <button className="la-btn la-btn-ghost" onClick={() => dispatchAction({ name: "SKIP_CURRENT_TASK", uid: tasks[taskIx].company_uid })}>Skip</button>
          <button className="la-btn la-btn-ghost" onClick={() => dispatchAction({ name: "NEXT_TASK" })}>Next</button>
        </Sheet>
      ) : null}
      {explain ? <ExplainPanel text={explain} onClose={() => dispatchAction({ name: "CLOSE_EXPLAIN" })} /> : null}
    </div>
  );
}

function ReviewPage({
  company, evidence, advanced, busy, err, gmailConnected, upcomingCall, rescheduleDraft, callActionMsg,
  onEvidence, onAdvanced, onExplain, onApprove, onSkip, onResearch, onAction, onBack,
  onOpenCalendar, onRescheduleDraft, onReschedule, onCancelCall,
}: {
  company: Prospect;
  evidence: boolean;
  advanced: boolean;
  busy: boolean;
  err: string;
  gmailConnected: boolean;
  upcomingCall: {
    googleEventId: string;
    title: string;
    start: string;
    end: string;
    status: string;
    googleUrl: string;
  } | null;
  rescheduleDraft: string;
  callActionMsg: string;
  onEvidence: () => void;
  onAdvanced: () => void;
  onExplain: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onResearch: () => void;
  onAction: (id: ProspectActionId) => void;
  onBack: () => void;
  onOpenCalendar: () => void;
  onRescheduleDraft: (v: string) => void;
  onReschedule: () => void;
  onCancelCall: () => void;
}) {
  const found = importantFindings(company);
  const opps = opportunities(company);
  const value = highValueTake(company);
  const offer = recommendOffer(company);
  const named = (company.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const primaryApprove = approveIsPrimary(company);
  const ads = company.ads || [];

  return (
    <div className="space-y-4">
      <section className="la-card la-card-accent">
        <ProspectReachCard
          company={company}
          heading="Learn more"
          gmailConnected={gmailConnected}
          busy={busy}
          onAction={onAction}
        />
        {err ? <div className="la-ribbon la-ribbon-bad mt-3">{err}</div> : null}
      </section>

      {upcomingCall ? (
        <section className="la-card" data-upcoming-call="1">
          <p className="la-kicker">Upcoming call</p>
          <h2 className="font-display mt-1 text-2xl">Call</h2>
          <p className="mt-2 text-sm"><b>Status:</b> Booked</p>
          <p className="text-sm"><b>Date:</b> {formatLong(ymdInTz(new Date(upcomingCall.start)))}</p>
          <p className="text-sm"><b>Time:</b> {formatTime(upcomingCall.start)}</p>
          <p className="text-sm"><b>Calendar:</b> Google Calendar</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="la-btn la-btn-primary" type="button" onClick={onOpenCalendar}>Open Calendar</button>
            <button className="la-btn la-btn-ghost" type="button" onClick={onCancelCall}>Cancel</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="la-field"
              value={rescheduleDraft}
              onChange={(e) => onRescheduleDraft(e.target.value)}
              placeholder="Reschedule to 1 PM"
              aria-label="New call time"
            />
            <button className="la-btn la-btn-ghost" type="button" onClick={onReschedule}>Reschedule</button>
          </div>
          {callActionMsg ? <p className="mt-2 text-sm text-muted">{callActionMsg}</p> : null}
        </section>
      ) : null}

      <section className="la-card">
        <Block title="1. Why consider them?">
          <p>{whyConsider(company)}</p>
        </Block>
        <Block title="2. What did we find?">
          <ul className="space-y-2">
            {found.map((f) => (
              <li key={f.label}><b>{f.label}:</b> {f.plain}</li>
            ))}
          </ul>
          {ads.length ? (
            <div className="mt-3 text-sm">
              <b>Advertising:</b>
              <ul className="mt-1 space-y-1">
                {ads.map((a) => (
                  <li key={a.network + a.source}>{a.network}: {a.label}. {a.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Block>
        <Block title="3. What could Lamb Ascension help with?">
          {opps.length ? (
            <ul className="space-y-3">
              {opps.map((o) => (
                <li key={o.code}>
                  <b>{o.title}</b>
                  <div className="text-sm text-muted">{o.plain}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No pitchable on-page opportunity from the research we actually have. We will not invent one.</p>
          )}
        </Block>
        <Block title="4. Could this be worth pursuing for the high-value offer?">
          <p className="mb-2 font-semibold">{value.verdict}</p>
          <p className="text-sm">This is a research class, not a claim they can pay $10,000/month. Review count is optional — it is not the only way in.</p>
          <p className="mb-1 mt-2 text-sm text-muted">Why:</p>
          <ul className="mb-2 list-disc pl-5 text-sm">{value.evidence.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mb-1 text-sm text-muted">What we still don’t know:</p>
          <ul className="list-disc pl-5 text-sm">{value.unknown.map((x) => <li key={x}>{x}</li>)}</ul>
        </Block>
        <Block title="5. Who should I contact?">
          {named.length ? (
            <ul className="space-y-2">
              {named.map((c) => (
                <li key={c.name + c.source}>
                  <b>{c.name}</b>{c.title && c.title !== "UNKNOWN" ? ` — ${c.title}` : ""}
                  <div className="text-sm text-muted">
                    {c.email ? `${c.email} (${c.email_status})` : "No business email on file"}
                    {c.profile_url ? ` · ${c.profile_url}` : ""}
                  </div>
                  <div className="text-xs text-muted">Source: {c.source}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p>UNKNOWN. We do not have a verified person yet. We will not guess a name or email.{company.hunter_skipped_reason ? ` ${company.hunter_skipped_reason}` : ""}</p>
          )}
        </Block>
        <Block title="6. What should I sell them?">
          <p className="mb-1"><b>{offer.name === "Unknown" ? "No offer yet" : offer.name}</b></p>
          <p className="text-sm">{offer.why}</p>
        </Block>
        <div className="la-brief-item">
          <h3 className="font-display mb-2 text-lg">7. What should I do next?</h3>
          <p className="mb-3">{nextStepLabel(company)}</p>
          {err ? <div className="err la-ribbon la-ribbon-bad mb-3">{err}</div> : null}
          <div className="flex flex-wrap gap-2">
            <button className={`la-btn ${primaryApprove ? "la-btn-ghost" : "la-btn-primary"}`} onClick={onResearch} disabled={busy}>
              {busy ? "Looking…" : "Find Contact"}
            </button>
            {verifiedWebsite(company) ? (
              <button className="la-btn la-btn-ghost" type="button" onClick={() => onAction("open_website")}>Open Website</button>
            ) : null}
            {listingPhone(company) ? (
              <button className="la-btn la-btn-ghost" type="button" onClick={() => onAction("call")}>Call</button>
            ) : null}
            <button className="la-btn la-btn-ghost" type="button" onClick={() => onAction("draft_outreach")}>Draft Outreach</button>
            <button className={`la-btn ${primaryApprove ? "la-btn-primary" : "la-btn-ghost"}`} onClick={onApprove}>
              Approve for outreach
            </button>
            <button className="la-btn la-btn-ghost" onClick={onSkip}>Skip</button>
            <button className="la-btn la-btn-ghost" onClick={onEvidence}>{evidence ? "Hide evidence" : "See evidence"}</button>
            <button className="la-btn la-btn-ghost" onClick={onExplain}>Explain this</button>
            <button className="la-btn la-btn-ghost" onClick={onBack}>Back</button>
          </div>
        </div>
      </section>

      {evidence ? (
        <section className="la-card">
          <h3 className="font-display mb-2 text-lg">Evidence (what we actually stored)</h3>
          {(company.facts || []).map((f) => (
            <div key={f.key + f.source} className="la-list-row text-sm">
              <div>
                <b>{f.key}</b> · {f.status}
                <div className="text-muted">{f.value} · {f.source} · {f.checked_at}</div>
              </div>
            </div>
          ))}
          {company.provider_place_id ? (
            <div className="la-list-row text-sm">
              <div>
                <b>Google listing</b>
                <div className="text-muted">Place ID: {company.provider_place_id}</div>
                {company.provider_source_url ? <div className="text-muted">Maps: {company.provider_source_url}</div> : null}
                {company.address ? <div className="text-muted">Address: {company.address}</div> : null}
                {company.provider_category ? <div className="text-muted">Category: {company.provider_category}</div> : null}
                {company.business_status ? <div className="text-muted">Listing status: {company.business_status}</div> : null}
              </div>
            </div>
          ) : null}
          {company.findings.map((f, i) => (
            <div key={f.id + i} className="la-list-row text-sm">
              <div>
                <b>{f.id}</b> · {f.status}
                <div className="text-muted">{f.result}{f.source ? ` · ${f.source}` : ""}</div>
              </div>
            </div>
          ))}
          <button className="la-btn la-btn-ghost mt-3" onClick={onAdvanced}>{advanced ? "Hide advanced" : "Advanced (cost & APIs)"}</button>
        </section>
      ) : null}

      {advanced && evidence ? (
        <section className="la-card">
          <h3 className="font-display mb-2 text-lg">Advanced</h3>
          <pre className="overflow-auto text-xs text-muted">{JSON.stringify({
            research_status: company.research_status,
            score: company.score,
            pages_fetched: company.pages_fetched ?? 0,
            estimated_cents: company.estimated_cents ?? 0,
            hunter_skipped_reason: company.hunter_skipped_reason || "",
            provider: company.provider || "",
            provider_place_id: company.provider_place_id || "",
            job_value_est: company.job_value_est,
            job_value_kind: company.job_value_kind || "UNKNOWN",
            note: "job_value_est is an INDUSTRY_ESTIMATE, not Google-provided revenue. Paid contact lookup only runs after a prospect already looks promising. Revenue stays UNKNOWN.",
          }, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="la-brief-item">
      <h3 className="font-display mb-2 text-lg">{title}</h3>
      {children}
    </div>
  );
}

function ExplainPanel({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <aside className="la-explain" data-explain-panel="1" aria-label="Explanation">
      <div className="la-explain-top">
        <p className="la-kicker">Ara</p>
        <button type="button" className="la-explain-close" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <h2 className="font-display mb-2 text-lg leading-tight">Explain this</h2>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </aside>
  );
}

function Sheet({ title, heading, text, onClose, children }: { title?: string; heading?: string; text: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="la-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="la-sheet">
        {title ? <p className="text-sm text-muted">{title}</p> : null}
        {heading ? <h2 className="font-display mb-2 mt-1 text-xl">{heading}</h2> : null}
        <p className="mb-4 whitespace-pre-wrap text-sm">{text}</p>
        <div className="flex flex-wrap gap-2">
          {children}
          <button className="la-btn la-btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
