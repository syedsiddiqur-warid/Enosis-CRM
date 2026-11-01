import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { PROVIDERS, isConfigured } from "./integrations";
import { getPropDefs } from "./properties";
import { missingChecks, readyChecksFor } from "./ready-check";
import { RESEARCH_COLUMNS, researchColumn, type ResearchColumn } from "./research";
import type { PropOption, UserLite } from "./types";

/** Stages a company can be in while it's still the research team's work. */
const RESEARCH_STAGES = ["Sourced", "Researching", "Researched", "Viable", "Callable", "Not viable"];
/** Cards per board column before "Load more", and rows per list page. */
export const BOARD_PAGE = 40;
export const LIST_PAGE = 50;
export const REQUEST_PAGE = 50;

export type ResearchView = "board" | "list" | "requests";

export interface ResearchSearchParams {
  view?: string;
  researcher?: string;
  source?: string;
  batch?: string;
  q?: string;
  /** List view */
  stage?: string;
  page?: string;
  /** Requests view */
  rstatus?: string;
  kind?: string;
  requester?: string;
  rpage?: string;
}

export interface ResearchFilters {
  researcher: string;
  source: string;
  batch: string;
  q: string;
}

export const filtersOf = (sp: ResearchSearchParams): ResearchFilters => ({ researcher: sp.researcher ?? "", source: sp.source ?? "", batch: sp.batch ?? "", q: sp.q?.trim() ?? "" });

/** Every company on the research queue that matches the filters, with its column, oldest first.
 *  Reads only a few columns, so it stays fast with tens of thousands of companies. */
export async function researchIndex(f: ResearchFilters, userId: string) {
  const where: Prisma.Sql[] = [Prisma.sql`c."deletedAt" IS NULL`, Prisma.sql`(c."leadState" IS NULL OR c."leadState" IN (${Prisma.join(RESEARCH_STAGES)}))`];
  if (f.researcher === "__me__") where.push(Prisma.sql`c."researcherId" = ${userId}`);
  else if (f.researcher === "__none__") where.push(Prisma.sql`c."researcherId" IS NULL`);
  else if (f.researcher) where.push(Prisma.sql`c."researcherId" = ${f.researcher}`);
  if (f.source) where.push(Prisma.sql`c."source" = ${f.source}`);
  if (f.batch) where.push(Prisma.sql`c."batchNumber" = ${f.batch}`);
  if (f.q) where.push(Prisma.sql`(c."name" ILIKE ${`%${f.q}%`} OR c."domain" ILIKE ${`%${f.q}%`})`);
  const rows = await db.$queryRaw<{ id: string; researchStatus: string | null; viable: string | null; callable: string | null; since: Date }[]>`
    SELECT c."id", c."researchStatus", c."properties"->>'viable' AS viable, c."properties"->>'callable' AS callable, COALESCE(c."leadStateAt", c."createdAt") AS since
    FROM "Company" c
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY COALESCE(c."leadStateAt", c."createdAt") ASC, c."id" ASC`;
  const monthAgo = Date.now() - 30 * 864e5;
  return (
    rows
      .map((r) => ({ id: r.id, column: researchColumn({ researchStatus: r.researchStatus, properties: { viable: r.viable, callable: r.callable } }), since: r.since }))
      // Rejected companies only stay on the queue for a month; callable ones until they join a campaign
      .filter((r) => r.column !== "not_viable" || r.since.getTime() >= monthAgo)
  );
}

export function columnCounts(index: { column: ResearchColumn }[]) {
  const counts = Object.fromEntries(RESEARCH_COLUMNS.map((c) => [c.id, 0])) as Record<ResearchColumn, number>;
  for (const r of index) counts[r.column]++;
  return counts;
}

/** Card details for a page of companies, in the order given. */
export async function researchCards(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.company.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      domain: true,
      source: true,
      listSource: true,
      batchNumber: true,
      researchStatus: true,
      researcherId: true,
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
  });
  const byId = new Map(
    rows.map((r) => [
      r.id,
      {
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
      },
    ]),
  );
  // Researched and viable companies show what still stops them being ready to call
  const checks = await readyChecksFor([...byId.values()].filter((c) => c.column === "researched" || c.column === "viable").map((c) => c.id));
  return ids
    .map((id) => byId.get(id))
    .filter((c) => !!c)
    .map((c) => ({ ...c, missing: checks.has(c.id) ? missingChecks(checks.get(c.id)!) : [] }));
}

export type ResearchCard = Awaited<ReturnType<typeof researchCards>>[number];

// ── Caller requests ──

const WAITING = ["Open", "In progress"];

export function requestWhere(sp: ResearchSearchParams, userId: string): Prisma.ResearchRequestWhereInput {
  const status = sp.rstatus || "waiting";
  return {
    ...(status === "waiting" ? { status: { in: WAITING } } : status === "mine" ? { status: "In progress", researcherId: userId } : status === "all" ? {} : { status }),
    ...(sp.kind ? { kind: sp.kind } : {}),
    ...(sp.requester ? { requestedById: sp.requester } : {}),
  };
}

async function loadRequests(sp: ResearchSearchParams, userId: string) {
  const page = Math.max(1, Number(sp.rpage) || 1);
  const where = requestWhere(sp, userId);
  const [rows, total, waiting, mine] = await Promise.all([
    db.researchRequest.findMany({
      where,
      include: {
        company: { select: { name: true, domain: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        campaign: { select: { name: true } },
        requestedBy: { select: { name: true } },
        researcher: { select: { name: true } },
      },
      // Oldest waiting first; finished ones newest first
      orderBy: (sp.rstatus || "waiting") === "waiting" ? { createdAt: "asc" } : { updatedAt: "desc" },
      skip: (page - 1) * REQUEST_PAGE,
      take: REQUEST_PAGE,
    }),
    db.researchRequest.count({ where }),
    db.researchRequest.count({ where: { status: { in: WAITING } } }),
    db.researchRequest.count({ where: { status: "In progress", researcherId: userId } }),
  ]);
  return {
    page,
    total,
    waiting,
    mine,
    filters: { rstatus: sp.rstatus || "waiting", kind: sp.kind ?? "", requester: sp.requester ?? "" },
    rows: rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      company: r.company.name,
      domain: r.company.domain,
      contactId: r.contactId,
      contact: r.contact ? fullName(r.contact) : null,
      campaign: r.campaign?.name ?? null,
      kind: r.kind,
      note: r.note,
      status: r.status,
      result: r.result,
      requestedBy: r.requestedBy?.name ?? null,
      researcher: r.researcher?.name ?? null,
      researcherId: r.researcherId,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export async function loadResearch(userId: string, sp: ResearchSearchParams) {
  const view: ResearchView = sp.view === "list" || sp.view === "requests" ? sp.view : "board";
  const filters = filtersOf(sp);
  const [index, users, defs, batches, integrations, requests] = await Promise.all([
    researchIndex(filters, userId),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: { select: { name: true } } }, orderBy: { name: "asc" } }),
    getPropDefs("COMPANY"),
    db.company.findMany({ where: { deletedAt: null, batchNumber: { not: null } }, distinct: ["batchNumber"], select: { batchNumber: true }, orderBy: { batchNumber: "desc" } }),
    db.integration.findMany(),
    loadRequests(sp, userId),
  ]);
  const counts = columnCounts(index);

  // Board: the first page of each column. List: one page of the chosen stage (or all).
  const stage = RESEARCH_COLUMNS.some((c) => c.id === sp.stage) ? (sp.stage as ResearchColumn) : null;
  const listRows = stage ? index.filter((r) => r.column === stage) : index;
  const page = Math.max(1, Math.min(Number(sp.page) || 1, Math.max(1, Math.ceil(listRows.length / LIST_PAGE))));
  const ids =
    view === "board"
      ? RESEARCH_COLUMNS.flatMap((col) => index.filter((r) => r.column === col.id).slice(0, BOARD_PAGE).map((r) => r.id))
      : view === "list"
        ? listRows.slice((page - 1) * LIST_PAGE, page * LIST_PAGE).map((r) => r.id)
        : [];

  const options = (name: string) => (defs.find((d) => d.name === name)?.options ?? []) as PropOption[];
  return {
    view,
    cards: await researchCards(ids),
    counts,
    total: index.length,
    list: { stage, page, total: listRows.length },
    requests,
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email })) as UserLite[],
    /** People with the Researcher role, offered first when assigning */
    researcherIds: users.filter((u) => u.role?.name === "Researcher").map((u) => u.id),
    sources: options("source"),
    listSources: options("listSource"),
    batches: batches.map((b) => b.batchNumber!).filter(Boolean),
    filters,
    currentUserId: userId,
    autoEnrich: PROVIDERS.filter((p) => p.kind === "api" && isConfigured(p) && integrations.find((i) => i.provider === p.id && i.enabled && (i.settings as { autoEnrichOnCreate?: boolean })?.autoEnrichOnCreate)).map(
      (p) => p.name,
    ),
  };
}

export type ResearchData = Awaited<ReturnType<typeof loadResearch>>;
