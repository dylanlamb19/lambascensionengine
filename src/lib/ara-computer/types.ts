export type ComputerDriver = "ara" | "human" | "stopped";

export type ComputerOp =
  | "inspect"
  | "click"
  | "scroll"
  | "type"
  | "back"
  | "stop"
  | "take_control"
  | "give_control"
  | "pointer"
  | "dispatch"
  | "navigate";

export type VisibleControl = {
  id: string;
  name: string;
  role: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  x?: number;
  y?: number;
};

export type ComputerSnapshot = {
  ok: boolean;
  reason?: string;
  jpeg?: string;
  url?: string;
  title?: string;
  view?: string;
  openUid?: string;
  lookingAt?: string;
  driver: ComputerDriver;
  controls: VisibleControl[];
  width: number;
  height: number;
  blocked?: string;
  event?: string;
};

export type ComputerActInput = {
  op: ComputerOp;
  name?: string;
  controlId?: string;
  text?: string;
  dy?: number;
  x?: number;
  y?: number;
  pointer?: "click" | "down" | "up" | "move";
  origin?: string;
  bearer?: string;
  action?: { name: string; uid?: string | null; findVertical?: string; findLocation?: string; findCount?: number };
};
