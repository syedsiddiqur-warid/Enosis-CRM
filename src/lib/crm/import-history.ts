// Import history and batch progress, shown in Data Management and Settings › Import & templates.
import { db } from "@/lib/db";
import { inResearchWhere } from "./in-research";

export type ImportJobRow = {
  id: string;
  object: "CONTACT" | "COMPANY";
  fileName: string;
  status: string;
  by: string | null;
  at: string;
  totalRows: number | null;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  segmentId: string | null;
};

export async function loadImportHistory(take = 50): Promise<ImportJobRow[]> {
  const jobs = await db.importJob.findMany({ orderBy: { createdAt: "desc" }, take, include: { user: { select: { name: true, email: true } } } });
  return jobs.map((j) => {
    const s = (j.summary ?? {}) as { totalRows?: number; created?: number; updated?: number; skipped?: number; errors?: number };
    const m = (j.mapping ?? {}) as { segmentId?: string | null };
    return {
      id: j.id,
      object: j.objectType as "CONTACT" | "COMPANY",
      fileName: j.fileName,
      status: j.status,
      by: j.user?.name ?? j.user?.email ?? null,
      at: j.createdAt.toISOString(),
      totalRows: s.totalRows ?? null,
      created: s.created ?? 0,
      updated: s.updated ?? 0,
      skipped: s.skipped ?? 0,
      errors: s.errors ?? 0,
      segmentId: m.segmentId ?? null,
    };
  });
}

export type BatchRow = { batch: string; companies: number; inResearch: number; ready: number; lastAt: string };

/** The most recent batches: how many of their companies are still with research and how many have moved on. */
export async function loadBatchProgress(take = 15): Promise<BatchRow[]> {
  const batches = await db.company.groupBy({
    by: ["batchNumber"],
    where: { deletedAt: null, batchNumber: { not: null } },
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take,
  });
  const names = batches.map((b) => b.batchNumber!);
  const researching = names.length
    ? await db.company.groupBy({ by: ["batchNumber"], where: { deletedAt: null, batchNumber: { in: names }, ...inResearchWhere }, _count: { _all: true } })
    : [];
  return batches.map((b) => {
    const inResearch = researching.find((r) => r.batchNumber === b.batchNumber)?._count._all ?? 0;
    return { batch: b.batchNumber!, companies: b._count._all, inResearch, ready: b._count._all - inResearch, lastAt: b._max.createdAt!.toISOString() };
  });
}
