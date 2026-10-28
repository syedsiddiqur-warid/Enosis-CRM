import { formatPhone } from "@/lib/utils";

interface ActivityLike {
  type: "CALL" | "EMAIL" | "NOTE" | "TASK" | "MEETING" | "SYSTEM";
  title: string | null;
  body: string | null;
  callResult: string | null;
  callPath: string | null;
  dialedNumber: string | null;
  systemData: unknown;
}

/** One-line description of an activity for previews and timelines. */
export function activitySummary(a: ActivityLike): string {
  switch (a.type) {
    case "CALL":
      return `Logged call${a.callResult ? ` – ${a.callResult}` : ""}${a.dialedNumber ? ` · ${formatPhone(a.dialedNumber)}` : ""}${a.callPath ? ` (${a.callPath})` : ""}`;
    case "TASK":
      return `Task: ${a.title ?? "Untitled"}`;
    case "NOTE":
      return `Note: ${(a.body ?? "").replace(/<[^>]+>/g, "").slice(0, 120)}`;
    case "SYSTEM": {
      const d = (a.systemData ?? {}) as { kind?: string; label?: string; to?: unknown; source?: string };
      if (d.kind === "imported") return `Created from Import${d.source ? ` (${d.source})` : ""}`;
      if (d.kind === "created") return "Record created";
      if (d.kind === "property_change") return `${d.label} changed to ${d.to === null || d.to === "" ? "(empty)" : String(d.to)}`;
      return "System event";
    }
    default:
      return a.title ?? a.type;
  }
}
