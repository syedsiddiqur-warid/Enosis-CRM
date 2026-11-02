// Bulk changes: shared by the list pages (client) and bulk-actions.ts (server).

/** Records per request when a bulk change runs, so thousands of records never hit a request limit or timeout. */
export const BULK_CHUNK = 200;
/** Most records one "select all matching" can pick up. */
export const MAX_SELECTION = 50000;
/** Above this, actions that send every id at once (segments, campaigns, tasks, delete) are switched off. */
export const MAX_DIRECT = 1000;

export type BulkTarget = { id: string; tz: string | null };
export type BulkItem = { id: string; changes: Record<string, unknown> };

/**
 * Share records out among people. "even": round robin. "timezone": records sorted by time zone (biggest zones first),
 * then cut into equal blocks, so each person gets whole zones where possible and the split stays even.
 */
export function shareOut(targets: BulkTarget[], userIds: string[], mode: "even" | "timezone"): Map<string, string> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  if (mode === "even") {
    targets.forEach((t, i) => out.set(t.id, userIds[i % userIds.length]));
    return out;
  }
  const zones = new Map<string, BulkTarget[]>();
  for (const t of targets) zones.set(t.tz ?? "", [...(zones.get(t.tz ?? "") ?? []), t]);
  const ordered = [...zones.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).flatMap(([, list]) => list);
  const size = Math.ceil(ordered.length / userIds.length);
  ordered.forEach((t, i) => out.set(t.id, userIds[Math.min(Math.floor(i / size), userIds.length - 1)]));
  return out;
}

/** How many records each person gets, and which time zones, for the preview. */
export function shareSummary(targets: BulkTarget[], plan: Map<string, string>) {
  const per = new Map<string, { count: number; zones: Map<string, number> }>();
  for (const t of targets) {
    const u = plan.get(t.id);
    if (!u) continue;
    const row = per.get(u) ?? { count: 0, zones: new Map() };
    row.count++;
    const z = t.tz ?? "No time zone";
    row.zones.set(z, (row.zones.get(z) ?? 0) + 1);
    per.set(u, row);
  }
  return per;
}
