// Nurture comes back: a company whose "ask again" date has arrived goes back to its caller, but if its research is
// older than six months, research re-checks it first (people move on, numbers change).
import { db } from "@/lib/db";

export const STALE_RESEARCH_DAYS = 180;
export const RECHECK_KIND = "Verify company info";
/** How long the company waits for the re-check before it comes back to the caller anyway */
const HOLD_DAYS = 14;

/**
 * Run when a calling queue loads: due Nurture returns in this campaign with stale research get a re-check request
 * and leave the queue until research sends it back. A few hundred at a time, so a big campaign never stalls the page.
 */
export async function recheckStaleReturns(campaignId: string) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_RESEARCH_DAYS * 864e5);
  const due = await db.campaignCompany.findMany({
    where: {
      campaignId,
      removedAt: null,
      nextActionAt: { lte: now },
      company: {
        deletedAt: null,
        revisitAt: { lte: now },
        OR: [{ researchedAt: null }, { researchedAt: { lt: staleBefore } }],
        // Not if research already has it, or re-checked it recently
        researchRequests: { none: { OR: [{ status: { in: ["Open", "In progress"] } }, { kind: RECHECK_KIND, createdAt: { gte: new Date(now.getTime() - 30 * 864e5) } }] } },
      },
    },
    select: { companyId: true, company: { select: { name: true, researcherId: true, researchedAt: true } } },
    take: 300,
  });
  if (!due.length) return 0;
  for (const m of due) {
    const age = m.company.researchedAt ? `${Math.floor((now.getTime() - m.company.researchedAt.getTime()) / (30 * 864e5))} months old` : "never recorded";
    await db.researchRequest.create({
      data: { companyId: m.companyId, campaignId, kind: RECHECK_KIND, note: `Back from Nurture. Research is ${age}: check the people, titles and numbers are still right.` },
    });
    await db.activity.create({
      data: {
        type: "SYSTEM",
        systemData: { kind: "property_change", label: "Research request", to: `${RECHECK_KIND} requested automatically (back from Nurture, research ${age})` },
        companies: { create: { companyId: m.companyId } },
      },
    });
    if (m.company.researcherId) {
      await db.notification.create({ data: { userId: m.company.researcherId, kind: "research_request", title: `Re-check before calling again: ${m.company.name}`, link: "/research" } });
    }
  }
  // Out of the queue until research sends it back (sending back puts it at the top again)
  await db.campaignCompany.updateMany({
    where: { campaignId, companyId: { in: due.map((m) => m.companyId) } },
    data: { nextActionAt: new Date(now.getTime() + HOLD_DAYS * 864e5) },
  });
  return due.length;
}
