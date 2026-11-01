// Handover pool: companies research marked callable that no open campaign has yet, with facets for slicing them into campaigns.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { JOURNEY_PROPERTY } from "./journey";
import { HANDOVER_PAGE, STALE_DAYS, type HandoverSearchParams } from "./handover";
import type { PropOption } from "./types";

const OPEN_CAMPAIGN = ["DRAFT", "ACTIVE", "PAUSED"] as const;

async function exitStages() {
  const def = await db.propertyDefinition.findUnique({ where: { objectType_name: { objectType: "COMPANY", name: JOURNEY_PROPERTY } }, select: { options: true } });
  return ((def?.options as PropOption[] | null) ?? []).filter((o) => o.kind === "exit").map((o) => o.value);
}

/** Every company in the pool: ready to call, not exited, and in no open campaign. */
export async function poolWhere(): Promise<Prisma.CompanyWhereInput> {
  const exits = await exitStages();
  return {
    deletedAt: null,
    readyAt: { not: null },
    properties: { path: ["callable"], equals: "Yes" },
    ...(exits.length ? { OR: [{ leadState: null }, { leadState: { notIn: exits } }] } : {}),
    campaigns: { none: { removedAt: null, campaign: { status: { in: [...OPEN_CAMPAIGN] } } } },
  };
}

/** The pool narrowed by the page's filters. */
export async function handoverWhere(f: HandoverSearchParams): Promise<Prisma.CompanyWhereInput> {
  const and: Prisma.CompanyWhereInput[] = [await poolWhere()];
  const q = f.q?.trim();
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] });
  // "(none)" picks companies without the value, so gaps are easy to find
  const eq = (field: "industry" | "country" | "timeZone" | "source" | "batchNumber" | "researcherId", v?: string) => {
    if (v) and.push({ [field]: v === "(none)" ? null : v });
  };
  eq("industry", f.industry);
  eq("country", f.country);
  eq("timeZone", f.tz);
  eq("source", f.source);
  eq("batchNumber", f.batch);
  eq("researcherId", f.researcher);
  const wait = Number(f.wait);
  if (wait > 0) and.push({ readyAt: { lte: new Date(Date.now() - wait * 864e5) } });
  return { AND: and };
}

async function facet(field: "industry" | "country" | "timeZone" | "source" | "batchNumber", where: Prisma.CompanyWhereInput) {
  const rows = await db.company.groupBy({ by: [field], where, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 60 });
  return rows.map((r) => ({ value: (r[field] as string | null) ?? "(none)", count: r._count._all }));
}

export async function loadHandover(sp: HandoverSearchParams) {
  const page = Math.max(1, Number(sp.page) || 1);
  const [pool, where] = await Promise.all([poolWhere(), handoverWhere(sp)]);
  const now = Date.now();
  const [total, matching, stale, old, sentWeek, rows, industries, countries, zones, sources, batches, users] = await Promise.all([
    db.company.count({ where: pool }),
    db.company.count({ where }),
    db.company.count({ where: { AND: [pool, { readyAt: { lte: new Date(now - STALE_DAYS * 864e5) } }] } }),
    db.company.count({ where: { AND: [pool, { readyAt: { lte: new Date(now - 30 * 864e5) } }] } }),
    // Handed over in the last 7 days: ready companies that joined a campaign
    db.company.count({ where: { deletedAt: null, readyAt: { not: null }, campaigns: { some: { removedAt: null, addedAt: { gte: new Date(now - 7 * 864e5) } } } } }),
    db.company.findMany({
      where,
      // Longest waiting first: research's oldest work goes to sales first
      orderBy: [{ readyAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * HANDOVER_PAGE,
      take: HANDOVER_PAGE,
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        employees: true,
        country: true,
        state: true,
        timeZone: true,
        source: true,
        batchNumber: true,
        readyAt: true,
        researcherId: true,
        followGroup: true,
        followScore: true,
        _count: { select: { contacts: true, phoneNumbers: true } },
        // A company back from an earlier campaign (e.g. Nurture) shows where it was
        campaigns: { where: { removedAt: null }, orderBy: { addedAt: "desc" }, take: 1, select: { status: true, campaign: { select: { id: true, name: true } } } },
      },
    }),
    facet("industry", pool),
    facet("country", pool),
    facet("timeZone", pool),
    facet("source", pool),
    facet("batchNumber", pool),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    filters: {
      q: sp.q ?? "",
      industry: sp.industry ?? "",
      country: sp.country ?? "",
      tz: sp.tz ?? "",
      source: sp.source ?? "",
      batch: sp.batch ?? "",
      researcher: sp.researcher ?? "",
      wait: sp.wait ?? "",
    },
    page,
    counts: { total, matching, stale, old, sentWeek },
    facets: { industries, countries, zones, sources, batches },
    users,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      industry: r.industry,
      employees: r.employees,
      country: r.country,
      state: r.state,
      timeZone: r.timeZone,
      source: r.source,
      batchNumber: r.batchNumber,
      readyAt: r.readyAt!.toISOString(),
      researcher: users.find((u) => u.id === r.researcherId)?.name ?? null,
      followGroup: r.followGroup,
      followScore: r.followScore,
      contacts: r._count.contacts,
      phones: r._count.phoneNumbers,
      lastCampaign: r.campaigns[0] ? { id: r.campaigns[0].campaign.id, name: r.campaigns[0].campaign.name, status: r.campaigns[0].status } : null,
    })),
  };
}

export type HandoverData = Awaited<ReturnType<typeof loadHandover>>;
