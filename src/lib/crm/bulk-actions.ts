"use server";

// Bulk changes on Companies, Contacts and Leads. The browser resolves the selection once (every record matching the
// list's filters, or the ticked ids), then sends the changes in chunks of BULK_CHUNK with a progress bar. Each chunk
// is logged with the old values, so the whole change can be undone, again chunk by chunk.
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { BULK_CHUNK, MAX_SELECTION, type BulkItem, type BulkTarget } from "./bulk";
import { loadQueryContext } from "./context";
import { updateLeads } from "./lead-actions";
import { leadWhere, type LeadSearchParams } from "./lead-loader";
import { buildWhere } from "./query";
import { applyUpdate, readRecord } from "./record-writes";
import type { ViewState } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

type ListObject = "COMPANY" | "CONTACT";
type BulkObject = ListObject | "LEAD";

/** A Companies / Contacts list as it's shown: view, filters, search and the "include companies in research" toggle. */
export interface ListSelection {
  systemKey: string | null;
  state: ViewState;
  q: string;
  includeResearch: boolean;
}

const LEAD_FIELDS = ["ownerId", "label", "leadType", "source"] as const;
type LeadField = (typeof LEAD_FIELDS)[number];

const tooMany = (n: number) => new Error(`${n.toLocaleString()} records match. Narrow the filters to ${MAX_SELECTION.toLocaleString()} or fewer`);

/** Every record a list shows (all pages), or the given ids, with time zones for sharing out by zone. */
export async function resolveSelection(object: ListObject, sel: ListSelection | { ids: string[] }): Promise<Result<{ targets: BulkTarget[] }>> {
  try {
    const user = await requireUser();
    let where: Record<string, unknown>;
    if ("ids" in sel) where = { id: { in: sel.ids.slice(0, MAX_SELECTION) }, deletedAt: null };
    else where = buildWhere(object, sel.systemKey, sel.state, sel.q, await loadQueryContext(user.id), sel.includeResearch);
    const args = { where, select: { id: true, timeZone: true }, orderBy: { id: "asc" as const }, take: MAX_SELECTION + 1 };
    const rows = object === "COMPANY" ? await db.company.findMany(args as never) : await db.contact.findMany(args as never);
    const list = rows as unknown as { id: string; timeZone: string | null }[];
    if (list.length > MAX_SELECTION) throw tooMany(await (object === "COMPANY" ? db.company.count({ where }) : db.contact.count({ where })));
    return { ok: true, data: { targets: list.map((r) => ({ id: r.id, tz: r.timeZone })) } };
  } catch (e) {
    return fail(e);
  }
}

/** Every lead the leads page shows with these filters (all pages), or the given ids. Time zone: the contact's, else the company's. */
export async function resolveLeadSelection(sel: LeadSearchParams | { ids: string[] }): Promise<Result<{ targets: BulkTarget[] }>> {
  try {
    const user = await requireUser();
    const where = "ids" in sel ? { id: { in: sel.ids.slice(0, MAX_SELECTION) }, deletedAt: null } : leadWhere(user.id, sel);
    const rows = await db.lead.findMany({
      where,
      select: { id: true, contact: { select: { timeZone: true } }, company: { select: { timeZone: true } } },
      orderBy: { id: "asc" },
      take: MAX_SELECTION + 1,
    });
    if (rows.length > MAX_SELECTION) throw tooMany(await db.lead.count({ where }));
    return { ok: true, data: { targets: rows.map((r) => ({ id: r.id, tz: r.contact?.timeZone ?? r.company?.timeZone ?? null })) } };
  } catch (e) {
    return fail(e);
  }
}

interface BulkLog {
  batchId: string;
  object: BulkObject;
  /** Old values of what actually changed, per record */
  before: { id: string; from: Record<string, unknown> }[];
  undone?: boolean;
}

/** One chunk of a bulk change. Each record can get its own values (e.g. a different owner when sharing out). */
export async function applyBulk(object: BulkObject, batchId: string, items: BulkItem[]): Promise<Result<{ updated: number; unchanged: number; failed: { id: string; error: string }[] }>> {
  try {
    const user = await requireUser();
    if (items.length > BULK_CHUNK) throw new Error("Too many records in one request");
    if (!/^[\w-]{8,64}$/.test(batchId)) throw new Error("Invalid batch");
    const before: BulkLog["before"] = [];
    const failed: { id: string; error: string }[] = [];
    let unchanged = 0;

    if (object === "LEAD") {
      for (const it of items) {
        if (Object.keys(it.changes).some((k) => !LEAD_FIELDS.includes(k as LeadField))) throw new Error("Leads can change owner, label, type and source in bulk");
      }
      const current = await db.lead.findMany({ where: { id: { in: items.map((i) => i.id) }, deletedAt: null }, select: { id: true, ownerId: true, label: true, leadType: true, source: true } });
      // Leads with the same new values go in one update
      const groups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
      for (const it of items) {
        const lead = current.find((l) => l.id === it.id);
        if (!lead) {
          failed.push({ id: it.id, error: "Not found" });
          continue;
        }
        const diff = Object.fromEntries(Object.entries(it.changes).filter(([k, v]) => (lead[k as LeadField] ?? null) !== (v || null)));
        if (!Object.keys(diff).length) {
          unchanged++;
          continue;
        }
        before.push({ id: lead.id, from: Object.fromEntries(Object.keys(diff).map((k) => [k, lead[k as LeadField] ?? null])) });
        const key = JSON.stringify(diff);
        groups.set(key, { patch: diff, ids: [...(groups.get(key)?.ids ?? []), lead.id] });
      }
      for (const g of groups.values()) {
        const res = await updateLeads(g.ids, g.patch);
        if (!res.ok) throw new Error(res.error);
      }
    } else {
      for (const it of items) {
        try {
          const record = (await readRecord(object, it.id)) as unknown as Record<string, unknown> & { properties: Record<string, unknown> | null };
          const from: Record<string, unknown> = {};
          for (const [prop, value] of Object.entries(it.changes)) {
            const old = prop in record ? record[prop] : (record.properties?.[prop] ?? null);
            if (await applyUpdate(object, it.id, prop, value, user.id)) from[prop] = old ?? null;
          }
          if (Object.keys(from).length) before.push({ id: it.id, from });
          else unchanged++;
        } catch (e) {
          failed.push({ id: it.id, error: e instanceof Error ? e.message : "Couldn't update" });
        }
      }
    }

    if (before.length) {
      const log: BulkLog = { batchId, object, before };
      await db.auditLog.create({ data: { action: "bulk", objectType: object, changes: log as never, userId: user.id } });
    }
    return { ok: true, data: { updated: before.length, unchanged, failed } };
  } catch (e) {
    return fail(e);
  }
}

/** Undo one logged chunk of a bulk change (newest first). Call until `remaining` is 0. */
export async function undoBulk(batchId: string): Promise<Result<{ restored: number; remaining: number }>> {
  try {
    const user = await requireUser();
    const logs = await db.auditLog.findMany({ where: { action: "bulk", userId: user.id, changes: { path: ["batchId"], equals: batchId } }, orderBy: { createdAt: "desc" } });
    const open = logs.filter((l) => !(l.changes as unknown as BulkLog).undone);
    if (!open.length) return { ok: true, data: { restored: 0, remaining: 0 } };
    const log = open[0];
    const data = log.changes as unknown as BulkLog;
    let restored = 0;
    if (data.object === "LEAD") {
      for (const b of data.before) {
        const res = await updateLeads([b.id], b.from);
        if (res.ok) restored++;
      }
    } else {
      for (const b of data.before) {
        try {
          for (const [prop, value] of Object.entries(b.from)) await applyUpdate(data.object, b.id, prop, value, user.id);
          restored++;
        } catch {
          // A record deleted or changed so the old value no longer applies stays as it is
        }
      }
    }
    await db.auditLog.update({ where: { id: log.id }, data: { changes: { ...data, undone: true } as never } });
    if (open.length === 1) revalidateBulk(data.object);
    return { ok: true, data: { restored, remaining: open.length - 1 } };
  } catch (e) {
    return fail(e);
  }
}

/** Refresh the lists once a whole bulk change has run. */
export async function finishBulk(object: BulkObject): Promise<Result> {
  try {
    await requireUser();
    revalidateBulk(object);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

function revalidateBulk(object: BulkObject) {
  revalidatePath(object === "LEAD" ? "/leads" : object === "CONTACT" ? "/contacts" : "/companies", "layout");
}
