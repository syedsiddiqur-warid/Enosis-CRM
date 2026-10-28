// Lead journey: the path every company takes from sourcing to customer, stored as
// Company.leadState (current stage) + JourneyEvent rows (history). Stage names and order
// come from the leadState property options; exit stages carry `kind: "exit"`.
import type { PropOption } from "./types";

export const JOURNEY_PROPERTY = "leadState";

/** Default stage names the system moves companies to. Admins can rename others, not these. */
export const STAGE = {
  sourced: "Sourced",
  researching: "Researching",
  researched: "Researched",
  viable: "Viable",
  notViable: "Not viable",
  callable: "Callable",
  inCampaign: "In campaign",
  calling: "Calling",
  connected: "Connected",
  meeting: "Meeting booked",
  opportunity: "Opportunity",
  customer: "Customer",
  disqualified: "Disqualified",
  nurture: "Nurture",
} as const;

export type JourneySource = "manual" | "sourcing" | "research" | "call" | "meeting" | "campaign" | "deal" | "import" | "enrichment";

export interface JourneyMeta {
  source: JourneySource;
  reason?: string | null;
  campaignId?: string | null;
  activityId?: string | null;
}

export function forwardStages(options: PropOption[]) {
  return options.filter((o) => o.kind !== "exit").map((o) => o.value);
}

export function isExit(stage: string | null | undefined, options: PropOption[]) {
  return !!stage && options.some((o) => o.value === stage && o.kind === "exit");
}

/** Automatic moves only go forward along the path; they never undo an exit or skip backwards.
 *  An automatic move to an exit stage (e.g. research says "Not viable") applies unless the
 *  company is already past calling. */
export function shouldMove(current: string | null | undefined, to: string, options: PropOption[]) {
  if (current === to) return false;
  const path = forwardStages(options);
  const cur = current ? path.indexOf(current) : -1;
  if (isExit(to, options)) return cur < path.indexOf(STAGE.calling);
  if (isExit(current, options)) return false;
  const next = path.indexOf(to);
  return next >= 0 && next > cur;
}

/** Stage a company moves to when one of its properties changes. */
export function stageForProperty(property: string, value: unknown): string | null {
  if (property === "researchStatus") return value === "In progress" || value === "Needs more info" ? STAGE.researching : value === "Done" ? STAGE.researched : null;
  if (property === "viable") return value === "Yes" ? STAGE.viable : value === "No" ? STAGE.notViable : null;
  if (property === "callable") return value === "Yes" ? STAGE.callable : null;
  return null;
}

/** Stage a company moves to when a call is logged against it or one of its contacts. */
export function stageForCall(result: string | null | undefined) {
  if (!result) return STAGE.calling;
  if (result === "Meeting Booked") return STAGE.meeting;
  if (/^connected/i.test(result) || result === "Callback Requested") return STAGE.connected;
  return STAGE.calling;
}

/** Company/contact call status after a call: the best reach so far wins. */
export function nextCallStatus(current: string | null | undefined, result: string | null | undefined) {
  const rank = ["Never Reached Targets", "Reached Gatekeeper", "Reached Target"];
  const reached = !result
    ? "Never Reached Targets"
    : /^connected/i.test(result) || ["Meeting Booked", "Callback Requested"].includes(result)
      ? "Reached Target"
      : ["Gatekeeper", "Transferred to VM"].includes(result)
        ? "Reached Gatekeeper"
        : "Never Reached Targets";
  if (current === "Do Not Call") return current;
  return rank.indexOf(reached) > rank.indexOf(current ?? "") ? reached : (current ?? reached);
}

/** Phone number status implied by a call outcome (null: the outcome says nothing about the number). */
export function phoneStatusForCall(result: string | null | undefined) {
  if (result === "Wrong Number") return "Wrong";
  if (result === "Temp Busy") return "Temp Busy";
  if (result && result !== "No Answer") return "Valid";
  return null;
}

/** Campaign membership status after a call. */
export function memberStatusForCall(current: string, result: string | null | undefined) {
  if (["Meeting booked", "Disqualified", "Completed"].includes(current)) return current;
  if (result === "Meeting Booked") return "Meeting booked";
  if (result === "Connected – Not Interested") return "Not interested";
  if (/^connected/i.test(result ?? "") || result === "Callback Requested") return "Connected";
  return current === "Queued" ? "In progress" : current;
}
