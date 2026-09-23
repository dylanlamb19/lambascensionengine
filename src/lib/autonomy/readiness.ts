export type ReadinessLight = "green" | "yellow" | "red" | "unknown";

export type LiveReadinessInput = {
  testFlowPassed: number;
  testFlowTotal: number;
  gmail: ReadinessLight;
  database: ReadinessLight;
  worker: ReadinessLight;
  outreach: ReadinessLight;
  calendar: ReadinessLight;
  booking: ReadinessLight;
  places: ReadinessLight;
  highCriticalOutreach: number;
  unknownDelivery: number;
  dncFutureSends: number;
  repliedFutureSends: number;
  duplicateOutreach: number;
  autopilotOn: boolean;
  liveCampaigns: number;
  productionSha: string;
  smoke: "pass" | "fail" | "unknown";
};

export function liveOutreachReadiness(input: LiveReadinessInput): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (input.testFlowPassed !== input.testFlowTotal || input.testFlowTotal !== 8) blockers.push("Test Sales Flow is not 8/8.");
  if (input.gmail !== "green") blockers.push("Gmail is not healthy.");
  if (input.database !== "green") blockers.push("Database is not healthy.");
  if (input.worker !== "green") blockers.push("Worker has not been observed healthy recently.");
  if (input.outreach !== "green") blockers.push("Outreach safety is not healthy.");
  if (input.calendar !== "green") blockers.push("Calendar is not healthy.");
  if (input.booking !== "green") blockers.push("Booking is not healthy.");
  if (input.places !== "green") blockers.push("Google Places is not healthy.");
  if (input.highCriticalOutreach > 0) blockers.push("A high or critical outreach issue is open.");
  if (input.unknownDelivery > 0) blockers.push("An email delivery is still unknown.");
  if (input.dncFutureSends > 0) blockers.push("A Do Not Contact company still has a future send.");
  if (input.repliedFutureSends > 0) blockers.push("A company that replied still has a future send.");
  if (input.duplicateOutreach > 0) blockers.push("Duplicate outreach is still active.");
  if (input.autopilotOn) blockers.push("Acquisition Autopilot is on. Controlled launch needs it off.");
  if (input.liveCampaigns > 0) blockers.push("A live campaign is still enabled.");
  if (!input.productionSha) blockers.push("Production SHA is not identified.");
  if (input.smoke !== "pass") blockers.push("Production smoke has not passed.");
  return { ready: blockers.length === 0, blockers };
}
