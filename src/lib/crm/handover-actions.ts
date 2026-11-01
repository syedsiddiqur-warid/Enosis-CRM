"use server";

import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import type { HandoverSearchParams } from "./handover";
import { handoverWhere } from "./handover-loader";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

const MAX = 20000;

/** "Select all matching": the ids of every pool company the filters match, longest waiting first. */
export async function handoverIdsMatching(sp: HandoverSearchParams): Promise<Result<{ ids: string[]; capped: boolean }>> {
  try {
    await requireUser();
    const rows = await db.company.findMany({ where: await handoverWhere(sp), orderBy: [{ readyAt: "asc" }, { id: "asc" }], take: MAX + 1, select: { id: true } });
    return { ok: true, data: { ids: rows.slice(0, MAX).map((r) => r.id), capped: rows.length > MAX } };
  } catch (e) {
    return fail(e);
  }
}
