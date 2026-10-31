"use server";

// Follow-ups page actions: set or clear when to ask companies again.
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { OPEN_STATUSES } from "./calling-queue";
import { rescoreCompanies } from "./follow-score";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Ask these companies again on a date (they rest until then and come back up in their campaign queues), or clear it. */
export async function setRevisitDate(companyIds: string[], at: string | null): Promise<Result<{ updated: number }>> {
  try {
    const user = await requireUser();
    if (!companyIds.length) throw new Error("Select companies first");
    if (companyIds.length > 5000) throw new Error("Set at most 5,000 companies at a time");
    const date = at ? new Date(at) : null;
    if (date && Number.isNaN(date.getTime())) throw new Error("Invalid date");
    await db.company.updateMany({ where: { id: { in: companyIds } }, data: { revisitAt: date } });
    if (date) {
      await db.campaignCompany.updateMany({
        where: { companyId: { in: companyIds }, removedAt: null, status: { in: OPEN_STATUSES }, campaign: { status: { in: ["ACTIVE", "PAUSED"] } } },
        data: { nextActionAt: date },
      });
    }
    await db.auditLog.createMany({
      data: companyIds.map((recordId) => ({ objectType: "COMPANY" as const, recordId, action: "update", changes: { revisitAt: { to: date?.toISOString() ?? null } }, userId: user.id })),
    });
    await rescoreCompanies(companyIds);
    revalidatePath("/follow-ups");
    revalidatePath("/prospecting", "layout");
    return { ok: true, data: { updated: companyIds.length } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
