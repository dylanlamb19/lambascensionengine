import type { HomeLayout, HomeWidget } from "../voice/layout.ts";
import type { VisualTheme } from "../visual/theme.ts";

export type DesignViewport = "global" | "mobile" | "desktop";
export type DesignActor = "DYLAN" | "ARA" | "CHATGPT_DESIGN_DIRECTOR";
export type DesignDirectorStatus = "disconnected" | "connected" | "designing" | "waiting" | "paused";
export type ComponentSize = "s" | "m" | "l" | "xl";
export type MainWidth = "narrow" | "default" | "wide";

export const DESIGN_COMPONENTS = [
  "greeting",
  "hero",
  "status",
  "up_next",
  "needs_you",
  "sales",
  "connections",
  "pipeline",
  "ara",
] as const;

export type DesignComponent = (typeof DESIGN_COMPONENTS)[number];

export type DesignChrome = {
  araScale: number;
  typeScale: number;
  spacingScale: number;
  mainWidth: MainWidth;
  widgetSize: Partial<Record<HomeWidget, ComponentSize>>;
};

export type ViewportPatch = {
  layout?: Partial<HomeLayout>;
  chrome?: Partial<DesignChrome>;
};

export type DesignDocument = {
  version: 1;
  visual: VisualTheme;
  layout: HomeLayout;
  chrome: DesignChrome;
  mobile: ViewportPatch;
  desktop: ViewportPatch;
};

export type DesignOp =
  | { op: "move_component"; component: DesignComponent; position: "top" | "bottom" | "higher" | "lower"; index?: number; viewport?: DesignViewport }
  | { op: "resize_component"; component: DesignComponent; size: ComponentSize; viewport?: DesignViewport }
  | { op: "hide_component"; component: DesignComponent; viewport?: DesignViewport }
  | { op: "show_component"; component: DesignComponent; viewport?: DesignViewport }
  | { op: "emphasize_component"; component: DesignComponent; viewport?: DesignViewport }
  | { op: "set_spacing"; density?: "comfortable" | "compact"; scale?: number; viewport?: DesignViewport }
  | { op: "set_typography"; scale: number; viewport?: DesignViewport }
  | { op: "set_background"; scene?: string; description?: string }
  | { op: "set_background_overlay"; amount?: number; delta?: number }
  | { op: "set_card_style"; glass?: boolean; opacity?: number }
  | { op: "set_accent_color"; amount?: number; delta?: number }
  | { op: "set_visual_density"; density: "comfortable" | "compact" }
  | { op: "set_ara_scale"; scale: number; viewport?: DesignViewport }
  | { op: "set_main_width"; width: MainWidth; viewport?: DesignViewport }
  | { op: "apply_layout"; order?: HomeWidget[]; hidden?: HomeWidget[]; emphasis?: HomeWidget | null; viewport?: DesignViewport }
  | { op: "undo_design_change" }
  | { op: "redo_design_change" }
  | { op: "reset_design" }
  | { op: "restore_baseline" };

export type DesignOpResult = {
  op: DesignOp["op"];
  ok: boolean;
  blocked: boolean;
  reason?: string;
  spoken: string;
};

export type DesignChange = {
  id: string;
  at: string;
  actor: DesignActor;
  ops: DesignOp[];
  previous: DesignDocument;
  resulting: DesignDocument;
  spoken: string;
};

export type DesignHistoryState = {
  past: DesignChange[];
  future: DesignChange[];
  baseline: DesignDocument | null;
};

export type SafeDesignSnapshot = {
  screen: string;
  viewport: "mobile" | "desktop";
  breakpoint: string;
  components: Array<{
    id: DesignComponent;
    name: string;
    visible: boolean;
    position: number | null;
    size: ComponentSize | "default";
    emphasized: boolean;
  }>;
  theme: {
    background: string;
    overlay: number;
    cardOpacity: number;
    cardGlass: boolean;
    accent: number;
    density: string;
  };
  chrome: DesignChrome;
  selectedComponent: DesignComponent | null;
};

export type DesignApplyRequest = {
  operations: DesignOp[];
  viewport?: DesignViewport;
  preview?: boolean;
  actor?: DesignActor;
};

export const DEFAULT_CHROME: DesignChrome = {
  araScale: 1,
  typeScale: 1,
  spacingScale: 1,
  mainWidth: "default",
  widgetSize: {},
};

export const FORBIDDEN_DESIGN_FIELDS = [
  "auth",
  "authentication",
  "password",
  "secret",
  "api_key",
  "database",
  "user_id",
  "gmail",
  "calendar",
  "send",
  "email_send",
  "test_mode",
  "billing",
  "permission",
  "security",
  "prospect",
  "outreach",
] as const;
