// Follow-up groups and caller feedback options. Shared by the server (scoring) and the client (calling screen, Follow-ups page).

export const FOLLOW_GROUPS = ["Chase now", "Nurture", "Keep trying", "Drop"] as const;
export type FollowGroup = (typeof FOLLOW_GROUPS)[number];

export const FOLLOW_GROUP_INFO: Record<FollowGroup, { color: string; help: string }> = {
  "Chase now": { color: "#00a38d", help: "Hot or warm and recently engaged. Call back first." },
  Nurture: { color: "#6a78d1", help: "Interested but not now. Stay in touch until the revisit date." },
  "Keep trying": { color: "#f5a623", help: "Not properly reached yet. Keep calling." },
  Drop: { color: "#99afc4", help: "Clear no. Stop spending time here." },
};

export const FEEDBACK_RATINGS = [
  { value: "Hot", color: "#f2545b", help: "Real interest, wants to talk further" },
  { value: "Warm", color: "#f5a623", help: "Open to it, needs more time or info" },
  { value: "Cold", color: "#7c98b6", help: "Polite but no real interest" },
] as const;

/** What callers can tick after a conversation; points feed the follow-up score. */
export const FEEDBACK_TAGS = [
  { key: "need_now", label: "Has a need now", short: "Need now", points: 10 },
  { key: "dm", label: "Decision maker reached", short: "DM reached", points: 8 },
  { key: "budget", label: "Budget available", short: "Budget", points: 8 },
  { key: "timeline", label: "Timeline under 3 months", short: "< 3 months", points: 8 },
  { key: "outsourcing", label: "Uses outsourcing today", short: "Outsources", points: 5 },
  { key: "info", label: "Asked for info / email", short: "Wants info", points: 4 },
  { key: "referred", label: "Wrong person, referred us on", short: "Referred", points: 2 },
  { key: "not_now", label: "Not now, ask again later", short: "Not now", points: 0 },
] as const;

/** Outcomes where the caller actually spoke to someone, so feedback makes sense. */
export const CONVERSATION_OUTCOMES = ["Connected – Interested", "Connected – Not Interested", "Callback Requested", "Meeting Booked"];
