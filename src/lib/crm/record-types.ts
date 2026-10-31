// Shapes shared by the record page loader (server) and the record page (client).
import type { CrmObject } from "./types";

export type QuickAction = "note" | "email" | "call" | "task" | "meeting" | "more";
export type ComposerKind = Exclude<QuickAction, "more">;

/** RecordLayout.config: the 3-column record page, stored as data and edited in Settings (step 11). */
export interface LayoutConfig {
  left: {
    keyInfo: string[];
    cards: { id: string; title: string; group?: string; properties?: string[] }[];
    quickActions: QuickAction[];
  };
  center: { tabs: { id: string; label: string; hidden?: boolean; cards: { id: string; kind: string; title?: string }[] }[] };
  right: {
    cards: {
      id: string;
      kind: "association" | "phone_numbers" | "case_studies" | "segments" | "lead_journey" | "buying_signals" | "campaigns";
      object?: CrmObject;
      title?: string;
      limit?: number;
    }[];
  };
}

export interface ActivityLink {
  id: string;
  name: string;
}

export interface RecordActivity {
  id: string;
  type: "NOTE" | "EMAIL" | "CALL" | "TASK" | "MEETING" | "SYSTEM";
  occurredAt: string;
  title: string | null;
  body: string | null;
  ownerId: string | null;
  assigneeId: string | null;
  // Call
  phoneNumberId: string | null;
  dialedNumber: string | null;
  callPath: string | null;
  callResult: string | null;
  gatekeeperType: string | null;
  durationSec: number | null;
  targetContact: ActivityLink | null;
  // Email
  subject: string | null;
  emailTo: string[];
  emailCc: string[];
  emailDirection: "INBOUND" | "OUTBOUND" | null;
  // Task
  dueAt: string | null;
  taskType: string | null;
  priority: string | null;
  taskStatus: "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | null;
  completedAt: string | null;
  // Meeting
  startAt: string | null;
  endAt: string | null;
  attendees: string[];
  location: string | null;
  meetingType: string | null;
  meetingOutcome: string | null;
  systemData: { kind?: string; label?: string; property?: string; from?: unknown; to?: unknown; source?: string; rule?: string; reason?: string } | null;
  contacts: ActivityLink[];
  companies: ActivityLink[];
  campaign: ActivityLink | null;
}

/** Composer input for logging or editing an activity. Dates are ISO strings. */
export interface ActivityInput {
  type: Exclude<RecordActivity["type"], "SYSTEM">;
  occurredAt?: string | null;
  title?: string | null;
  body?: string | null;
  assigneeId?: string | null;
  phoneNumberId?: string | null;
  dialedNumber?: string | null;
  callPath?: string | null;
  callResult?: string | null;
  gatekeeperType?: string | null;
  durationSec?: number | null;
  targetContactId?: string | null;
  /** Calls: caller feedback after a real conversation */
  feedbackRating?: string | null;
  feedbackTags?: string[];
  /** "Not now": ask again on this date; the company comes back to the calling queue then */
  revisitAt?: string | null;
  subject?: string | null;
  emailTo?: string[];
  emailCc?: string[];
  emailDirection?: "INBOUND" | "OUTBOUND" | null;
  dueAt?: string | null;
  taskType?: string | null;
  priority?: string | null;
  reminderAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  attendees?: string[];
  location?: string | null;
  meetingType?: string | null;
  meetingOutcome?: string | null;
  /** Also create a follow-up task (notes and calls) */
  followUp?: { title: string; taskType: string; dueAt: string } | null;
  /** Campaign the call or meeting was made for (the company must be a member) */
  campaignId?: string | null;
}
