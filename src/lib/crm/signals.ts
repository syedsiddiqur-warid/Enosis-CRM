// Buying signals on companies. Server-only.
import { db } from "@/lib/db";

/** Keep Company.signalTypes / lastSignalAt (used by filters, chips and columns) in step with its signals. */
export async function refreshSignalRollup(companyId: string) {
  const signals = await db.buyingSignal.findMany({
    where: { companyId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { type: true, detectedAt: true },
    orderBy: { detectedAt: "desc" },
  });
  await db.company.update({
    where: { id: companyId },
    data: { signalTypes: [...new Set(signals.map((s) => s.type))], lastSignalAt: signals[0]?.detectedAt ?? null },
  });
}

export interface SignalInput {
  type: string;
  title: string;
  detail?: string | null;
  url?: string | null;
  source: string;
  strength?: string | null;
  detectedAt?: string | null;
  expiresAt?: string | null;
}

/** Create a signal (skipping an identical one already logged) and write it to the company timeline. */
export async function createSignal(companyId: string, input: SignalInput, userId: string | null) {
  const title = input.title.trim();
  if (!input.type) throw new Error("Choose a signal type");
  if (!title) throw new Error("Describe the signal");
  if (input.url && !/^https?:\/\//i.test(input.url.trim())) throw new Error("Links must start with http:// or https://");
  const detectedAt = input.detectedAt ? new Date(input.detectedAt) : new Date();
  if (Number.isNaN(detectedAt.getTime())) throw new Error("Invalid signal date");
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

  const dupe = await db.buyingSignal.findFirst({ where: { companyId, type: input.type, title } });
  if (dupe) return { signal: dupe, created: false };
  const signal = await db.buyingSignal.create({
    data: {
      companyId,
      type: input.type,
      title,
      detail: input.detail?.trim() || null,
      url: input.url?.trim() || null,
      source: input.source || "Manual research",
      strength: input.strength || "Medium",
      detectedAt,
      expiresAt,
      createdById: userId,
    },
  });
  await db.activity.create({
    data: {
      type: "SYSTEM",
      ownerId: userId,
      occurredAt: new Date(),
      systemData: { kind: "signal", label: input.type, to: title, source: signal.source },
      companies: { create: { companyId } },
    },
  });
  await refreshSignalRollup(companyId);
  return { signal, created: true };
}
