export type VoiceMode = "off" | "ptt" | "conversation";
export type InputMethod = "MANUAL" | "VOICE" | "AUTOMATION";
export type Risk = "LOW" | "MEDIUM" | "HIGH";

export type IntentName =
  | "GET_DAILY_TASKS"
  | "START_TASKS"
  | "NEXT_TASK"
  | "PREVIOUS_TASK"
  | "ACKNOWLEDGE_TASK"
  | "COMPUTER_SCROLL"
  | "TAKE_CONTROL"
  | "GIVE_CONTROL"
  | "LAYOUT"
  | "NAVIGATE_HOME"
  | "NAVIGATE_PIPELINE"
  | "NAVIGATE_SETTINGS"
  | "NAVIGATE_CALENDAR"
  | "CALENDAR_TODAY"
  | "CALENDAR_NEXT"
  | "CALENDAR_PREV"
  | "CALENDAR_DAY"
  | "CALENDAR_WEEK"
  | "CALENDAR_MONTH"
  | "CALENDAR_AT"
  | "OPEN_PROSPECT"
  | "OPEN_REVIEW"
  | "OPEN_OUTREACH"
  | "DRAFT_OUTREACH"
  | "FIND_CLIENTS"
  | "RESEARCH_FURTHER"
  | "FIND_CONTACT"
  | "OPEN_WEBSITE"
  | "CALL_PROSPECT"
  | "EXPLAIN_PROSPECT"
  | "SHOW_EXPLAIN_PANEL"
  | "CLOSE_EXPLAIN"
  | "READ_PAGE"
  | "READ_EVERYTHING"
  | "READ_WARNING"
  | "READ_FORM"
  | "READ_OPTIONS"
  | "READ_OUTREACH"
  | "APPROVE_PROSPECT"
  | "SKIP_PROSPECT"
  | "SHOW_EVIDENCE"
  | "READ_CALL_OPENER"
  | "MAKE_EMAIL_SHORTER"
  | "GO_BACK"
  | "CANCEL"
  | "STOP_SPEECH"
  | "STOP_LISTENING"
  | "SEND_EMAIL"
  | "CONFIRM"
  | "READ_REPLY"
  | "DRAFT_RESPONSE"
  | "STOP_FOLLOWUPS"
  | "NEXT_CALL"
  | "AVAILABILITY"
  | "SCHEDULE_CALL"
  | "UNKNOWN";

export type ParsedIntent = {
  intent: IntentName;
  risk: Risk;
  companyQuery: string;
  confidence: number;
  raw: string;
  findVertical?: string;
  findLocation?: string;
  findCount?: number;
  hour?: number;
};

export type VoiceContext = {
  openUid: string | null;
  companies: { uid: string; name: string; score?: number }[];
};

export const HIGH_INTENTS: IntentName[] = ["SEND_EMAIL", "SCHEDULE_CALL"];
export const MEDIUM_INTENTS: IntentName[] = ["APPROVE_PROSPECT", "SKIP_PROSPECT", "STOP_FOLLOWUPS"];

/** Screens Ara is allowed to open. Same names Owner Mode uses. */
export type OwnerView = "home" | "add" | "find" | "pipe" | "detail" | "outreach" | "call" | "prep" | "settings" | "calendar";
