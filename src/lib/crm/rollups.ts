// Recalculate calling rollups from logged calls (used after importing call history). Server-only.
// Imported counts are never lowered: Dynamics CRT counts can include calls that were never written down.
import { db } from "@/lib/db";
import { nextCallStatus } from "./journey";

type Call = { occurredAt: Date; callResult: string | null };

function summarize(calls: Call[], current: { crtCount: number; connectedCount: number; callStatus: string | null; lastCallAt: Date | null }) {
  const sorted = [...calls].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const connected = sorted.filter((c) => /^connected/i.test(c.callResult ?? "")).length;
  const last = sorted.at(-1)?.occurredAt ?? null;
  return {
    crtCount: Math.max(current.crtCount, sorted.length),
    connectedCount: Math.max(current.connectedCount, connected),
    callStatus: sorted.length ? sorted.reduce<string | null>((s, c) => nextCallStatus(s, c.callResult), current.callStatus) : current.callStatus,
    lastCallAt: last && (!current.lastCallAt || last > current.lastCallAt) ? last : current.lastCallAt,
  };
}

export async function recomputeCallRollups(companyId: string | null, contactIds: string[]) {
  const now = new Date();
  for (const id of new Set(contactIds)) {
    const c = await db.contact.findUnique({ where: { id }, select: { crtCount: true, connectedCount: true, callStatus: true, lastCallAt: true, lastContactedAt: true, lastActivityAt: true } });
    if (!c) continue;
    const calls = await db.activity.findMany({ where: { type: "CALL", deletedAt: null, targetContactId: id, occurredAt: { lte: now } }, select: { occurredAt: true, callResult: true } });
    const s = summarize(calls, c);
    await db.contact.update({
      where: { id },
      data: {
        ...s,
        lastContactedAt: s.lastCallAt && (!c.lastContactedAt || s.lastCallAt > c.lastContactedAt) ? s.lastCallAt : c.lastContactedAt,
        lastActivityAt: s.lastCallAt && (!c.lastActivityAt || s.lastCallAt > c.lastActivityAt) ? s.lastCallAt : c.lastActivityAt,
      },
    });
  }
  if (companyId) {
    const co = await db.company.findUnique({ where: { id: companyId }, select: { crtCount: true, connectedCount: true, callStatus: true, lastCallAt: true, lastContactedAt: true, lastActivityAt: true } });
    if (!co) return;
    const calls = await db.activity.findMany({ where: { type: "CALL", deletedAt: null, companies: { some: { companyId } }, occurredAt: { lte: now } }, select: { occurredAt: true, callResult: true } });
    const s = summarize(calls, co);
    await db.company.update({
      where: { id: companyId },
      data: {
        ...s,
        lastContactedAt: s.lastCallAt && (!co.lastContactedAt || s.lastCallAt > co.lastContactedAt) ? s.lastCallAt : co.lastContactedAt,
        lastActivityAt: s.lastCallAt && (!co.lastActivityAt || s.lastCallAt > co.lastActivityAt) ? s.lastCallAt : co.lastActivityAt,
      },
    });
  }
}
