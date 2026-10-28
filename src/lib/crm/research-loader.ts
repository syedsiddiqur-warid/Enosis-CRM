import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PROVIDERS, isConfigured } from "./integrations";
import { getPropDefs } from "./properties";
import { researchColumn } from "./research";
import type { PropOption, UserLite } from "./types";

/** Stages a company can be in while it's still the research team's work. */
const RESEARCH_STAGES = ["Sourced", "Researching", "Researched", "Viable", "Callable", "Not viable"];

export interface ResearchSearchParams {
  researcher?: string;
  source?: string;
  batch?: string;
  q?: string;
}

export async function loadResearch(userId: string, sp: ResearchSearchParams) {
  const q = sp.q?.trim();
  const where: Prisma.CompanyWhereInput = {
    deletedAt: null,
    OR: [{ leadState: null }, { leadState: { in: RESEARCH_STAGES } }],
    ...(sp.researcher === "__me__" ? { researcherId: userId } : sp.researcher === "__none__" ? { researcherId: null } : sp.researcher ? { researcherId: sp.researcher } : {}),
    ...(sp.source ? { source: sp.source } : {}),
    ...(sp.batch ? { batchNumber: sp.batch } : {}),
    ...(q ? { AND: [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] }] } : {}),
  };
  const [rows, users, defs, batches, integrations] = await Promise.all([
    db.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        domain: true,
        source: true,
        listSource: true,
        batchNumber: true,
        researchStatus: true,
        researcherId: true,
        leadState: true,
        leadStateAt: true,
        createdAt: true,
        employees: true,
        country: true,
        industry: true,
        signalTypes: true,
        lastEnrichedAt: true,
        properties: true,
        _count: { select: { contacts: true, phoneNumbers: true } },
      },
      orderBy: [{ leadStateAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      take: 600,
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    getPropDefs("COMPANY"),
    db.company.findMany({ where: { deletedAt: null, batchNumber: { not: null } }, distinct: ["batchNumber"], select: { batchNumber: true }, orderBy: { batchNumber: "desc" } }),
    db.integration.findMany(),
  ]);
  const monthAgo = Date.now() - 30 * 864e5;
  const cards = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      source: r.source,
      listSource: r.listSource,
      batchNumber: r.batchNumber,
      researchStatus: r.researchStatus,
      researcherId: r.researcherId,
      employees: r.employees,
      country: r.country,
      industry: r.industry,
      signalTypes: r.signalTypes,
      contacts: r._count.contacts,
      phones: r._count.phoneNumbers,
      enriched: !!r.lastEnrichedAt,
      since: (r.leadStateAt ?? r.createdAt).toISOString(),
      column: researchColumn(r),
    }))
    // Rejected companies only stay on the board for a month; callable ones until they join a campaign
    .filter((c) => c.column !== "not_viable" || new Date(c.since).getTime() >= monthAgo);

  const options = (name: string) => (defs.find((d) => d.name === name)?.options ?? []) as PropOption[];
  return {
    cards,
    users: users as UserLite[],
    sources: options("source"),
    listSources: options("listSource"),
    batches: batches.map((b) => b.batchNumber!).filter(Boolean),
    filters: { researcher: sp.researcher ?? "", source: sp.source ?? "", batch: sp.batch ?? "", q: q ?? "" },
    currentUserId: userId,
    autoEnrich: PROVIDERS.filter((p) => p.kind === "api" && isConfigured(p) && integrations.find((i) => i.provider === p.id && i.enabled && (i.settings as { autoEnrichOnCreate?: boolean })?.autoEnrichOnCreate)).map(
      (p) => p.name,
    ),
  };
}

export type ResearchData = Awaited<ReturnType<typeof loadResearch>>;
