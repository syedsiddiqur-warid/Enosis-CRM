// Lead pipeline: stages, types and reasons. Shared by the server (lead tracking) and the client (Leads page, dialogs).

export const LEAD_STAGES = [
  { value: "New", color: "#00a4bd", help: "Not worked yet" },
  { value: "Attempting", color: "#f5a623", help: "Calling, not reached yet" },
  { value: "Connected", color: "#6a78d1", help: "Spoke to them, finding out if there is a fit" },
  { value: "Qualified", color: "#00a38d", help: "Real opportunity: interested and a fit" },
  { value: "Disqualified", color: "#99afc4", help: "No fit, or said no" },
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number]["value"];
export const LEAD_STAGE_NAMES = LEAD_STAGES.map((s) => s.value) as LeadStage[];
/** Stages still being worked. */
export const OPEN_LEAD_STAGES: LeadStage[] = ["New", "Attempting", "Connected"];
export const leadStageColor = (stage: string) => LEAD_STAGES.find((s) => s.value === stage)?.color ?? "#cbd6e2";

export const LEAD_TYPES = ["New business", "Existing business", "Re-engagement"] as const;

export const LEAD_SOURCES = ["Cold call", "Campaign", "Referral", "Inbound", "Event", "Import", "Other"] as const;

export const DISQUALIFY_REASONS = [
  "Not interested",
  "No need for outsourcing",
  "No budget",
  "Bad timing",
  "Wrong contact",
  "Went with a competitor",
  "Could not reach",
  "Do not contact",
  "Other",
] as const;

/** Contact lead status that matches each lead stage. */
export const LEAD_STATUS_FOR_STAGE: Record<LeadStage, string> = {
  New: "New",
  Attempting: "Attempted to contact",
  Connected: "Connected",
  Qualified: "In progress",
  Disqualified: "Unqualified",
};

/** Outcomes that mean the caller spoke to the person. */
export const isConversation = (result: string | null | undefined) => !!result && (/^connected/i.test(result) || result === "Callback Requested" || result === "Meeting Booked");

/** Outcomes good enough to open a lead automatically when the person has none. */
export const LEAD_WORTHY_OUTCOMES = ["Connected – Interested", "Callback Requested", "Meeting Booked"];

/** Where an open lead goes after a call. Calls only ever move a lead forward; qualifying and disqualifying are people's decisions. */
export function leadStageForCall(current: string, result: string | null | undefined): LeadStage {
  if (!OPEN_LEAD_STAGES.includes(current as LeadStage)) return current as LeadStage;
  if (isConversation(result)) return "Connected";
  return current === "New" ? "Attempting" : (current as LeadStage);
}
