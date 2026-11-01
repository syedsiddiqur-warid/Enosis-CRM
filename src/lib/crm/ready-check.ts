// Ready to call: the checklist a researched company passes before research may hand it to sales.
// Shared by the research board, the "Callable = Yes" gate and the Handover page.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface ReadyCheck {
  key: "industry" | "country" | "timeZone" | "decisionMaker" | "number";
  label: string;
  ok: boolean;
}

const DEAD = ["Wrong", "Disconnected"];

/** What the checklist needs from a company (one query for many companies). */
export const READY_SELECT = {
  id: true,
  industry: true,
  country: true,
  timeZone: true,
  phone: true,
  phoneNumbers: { select: { status: true } },
  contacts: {
    where: { contact: { deletedAt: null } },
    select: { contact: { select: { jobTitle: true, doNotCall: true, phone: true, mobile: true } } },
  },
} satisfies Prisma.CompanySelect;

export type ReadyInput = Prisma.CompanyGetPayload<{ select: typeof READY_SELECT }>;

export function readyChecks(c: ReadyInput): ReadyCheck[] {
  const people = c.contacts.map((l) => l.contact).filter((p) => !p.doNotCall);
  const hasNumber = !!c.phone || c.phoneNumbers.some((p) => !DEAD.includes(p.status)) || people.some((p) => p.phone || p.mobile);
  return [
    { key: "industry", label: "Industry", ok: !!c.industry?.trim() },
    { key: "country", label: "Country", ok: !!c.country?.trim() },
    { key: "timeZone", label: "Time zone", ok: !!c.timeZone },
    { key: "decisionMaker", label: "A person with a job title", ok: people.some((p) => !!p.jobTitle?.trim()) },
    { key: "number", label: "A working number", ok: hasNumber },
  ];
}

export const missingChecks = (checks: ReadyCheck[]) => checks.filter((c) => !c.ok).map((c) => c.label);

/** Checklist results for many companies, keyed by id. */
export async function readyChecksFor(ids: string[]) {
  const out = new Map<string, ReadyCheck[]>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db.company.findMany({ where: { id: { in: ids.slice(i, i + 1000) } }, select: READY_SELECT });
    for (const r of rows) out.set(r.id, readyChecks(r));
  }
  return out;
}

/** Throws with what's missing when a company isn't ready to hand to sales. */
export async function assertReadyToCall(companyId: string) {
  const row = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: READY_SELECT });
  const missing = missingChecks(readyChecks(row));
  if (missing.length) throw new Error(`Not ready to call yet. Missing: ${missing.join(", ")}`);
}
