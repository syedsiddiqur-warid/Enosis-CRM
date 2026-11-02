// Dashboards: the whole funnel from sourcing to client, research and handover throughput, and caller activity.
// Every number is a database aggregate (no rows are loaded), cached for a few minutes so large databases stay fast.
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { PERIODS, type DashboardSearchParams } from "./dashboards";
import { CONVERSATION_OUTCOMES } from "./follow-up";
import { poolWhere } from "./handover-loader";
import { JOURNEY_PROPERTY, STAGE } from "./journey";
import { getPropDefs } from "./properties";
import type { PropOption } from "./types";

const NONE = "(none)";
const int = (v: unknown) => Number(v ?? 0);

function periodStart(period: string) {
  if (period === "all") return new Date(0);
  return new Date(Date.now() - (Number(period) || 30) * 864e5);
}

/** Forward journey stages in order, and the exits. */
async function stages() {
  const opts = ((await getPropDefs("COMPANY")).find((d) => d.name === JOURNEY_PROPERTY)?.options ?? []) as PropOption[];
  const sorted = [...opts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { path: sorted.filter((o) => o.kind !== "exit"), exits: sorted.filter((o) => o.kind === "exit") };
}

/** How many companies reached each stage (or a later one): counts[i] = companies whose furthest stage is at least path[i]. */
function reachedCounts(rows: { r: unknown; n: unknown }[], len: number) {
  const at = new Array(len + 1).fill(0);
  for (const row of rows) at[Math.min(len, int(row.r))] += int(row.n);
  const reached = new Array(len).fill(0);
  let run = 0;
  for (let i = len; i >= 1; i--) {
    run += at[i];
    reached[i - 1] = run;
  }
  return reached as number[];
}

async function compute(period: string, source: string, campaign: string) {
  const from = periodStart(period);
  const { path, exits } = await stages();
  const names = path.map((p) => p.value);
  const sourceSql = source ? (source === NONE ? Prisma.sql`AND c."source" IS NULL` : Prisma.sql`AND c."source" = ${source}`) : Prisma.empty;
  const campaignSql = campaign ? Prisma.sql`AND a."campaignId" = ${campaign}` : Prisma.empty;
  const pool = await poolWhere();
  const dayMs = 864e5;
  const now = Date.now();
  const seriesDays = period === "7" ? 7 : period === "30" ? 30 : 90;

  const [
    activeRows,
    cohortRows,
    nowRows,
    sources,
    intake,
    intakeBySource,
    intakeByBatch,
    researchCols,
    researched,
    researchEvents,
    toReady,
    poolSize,
    wait7,
    wait30,
    readied,
    sent,
    callers,
    outcomes,
    series,
    users,
    campaigns,
  ] = await Promise.all([
    // Activity funnel: companies that moved in the period, by the furthest stage they reached in it
    db.$queryRaw<{ r: number; n: number }[]>`
      SELECT r, COUNT(*)::int AS n FROM (
        SELECT je."companyId", MAX(array_position(${names}::text[], je."toStage")) AS r
        FROM "JourneyEvent" je JOIN "Company" c ON c.id = je."companyId"
        WHERE je."at" >= ${from} AND c."deletedAt" IS NULL AND je."toStage" = ANY(${names}::text[]) ${sourceSql}
        GROUP BY je."companyId"
      ) t GROUP BY r`,
    // Cohort: companies sourced in the period, by source and the furthest stage they've reached since (any time)
    db.$queryRaw<{ src: string; r: number; n: number }[]>`
      SELECT src, r, COUNT(*)::int AS n FROM (
        SELECT c.id, COALESCE(c."source", ${NONE}) AS src, COALESCE(MAX(array_position(${names}::text[], je."toStage")), 1) AS r
        FROM "Company" c LEFT JOIN "JourneyEvent" je ON je."companyId" = c.id
        WHERE c."deletedAt" IS NULL AND c."createdAt" >= ${from} ${sourceSql}
        GROUP BY c.id, c."source"
      ) t GROUP BY src, r`,
    // Where companies are right now
    db.$queryRaw<{ stage: string | null; n: number }[]>`
      SELECT c."leadState" AS stage, COUNT(*)::int AS n FROM "Company" c WHERE c."deletedAt" IS NULL ${sourceSql} GROUP BY c."leadState"`,
    db.company.groupBy({ by: ["source"], where: { deletedAt: null }, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 40 }),

    // Research
    db.company.count({ where: { deletedAt: null, createdAt: { gte: from } } }),
    db.company.groupBy({ by: ["source"], where: { deletedAt: null, createdAt: { gte: from } }, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 10 }),
    db.company.groupBy({ by: ["batchNumber"], where: { deletedAt: null, createdAt: { gte: from } }, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take: 10 }),
    db.$queryRaw<{ col: string; n: number }[]>`
      SELECT CASE
        WHEN properties->>'viable' = 'No' THEN 'not_viable'
        WHEN properties->>'callable' = 'Yes' THEN 'callable'
        WHEN properties->>'viable' = 'Yes' THEN 'viable'
        WHEN "researchStatus" = 'Done' THEN 'researched'
        WHEN "researchStatus" IN ('In progress', 'Needs more info') THEN 'researching'
        ELSE 'to_research' END AS col, COUNT(*)::int AS n
      FROM "Company" WHERE "deletedAt" IS NULL GROUP BY 1`,
    db.company.groupBy({ by: ["researcherId"], where: { deletedAt: null, researchedAt: { gte: from } }, _count: { _all: true } }),
    db.journeyEvent.groupBy({
      by: ["userId", "toStage"],
      where: { at: { gte: from }, toStage: { in: [STAGE.viable, STAGE.notViable, STAGE.callable] }, company: { deletedAt: null } },
      _count: { _all: true },
    }),
    db.$queryRaw<{ avg: number | null; n: number }[]>`
      SELECT
        -- Research dates carried over from an old CRM can predate the import; only time measured here counts
        (AVG(EXTRACT(EPOCH FROM ("readyAt" - "createdAt")) / 86400) FILTER (WHERE "readyAt" >= "createdAt"))::float AS avg,
        COUNT(*)::int AS n
      FROM "Company" WHERE "deletedAt" IS NULL AND "readyAt" >= ${from}`,

    // Handover
    db.company.count({ where: pool }),
    db.company.count({ where: { AND: [pool, { readyAt: { lte: new Date(now - 7 * dayMs) } }] } }),
    db.company.count({ where: { AND: [pool, { readyAt: { lte: new Date(now - 30 * dayMs) } }] } }),
    db.company.count({ where: { deletedAt: null, readyAt: { gte: from } } }),
    db.$queryRaw<{ n: number; avg: number | null }[]>`
      SELECT COUNT(DISTINCT cc."companyId")::int AS n,
        -- Research dates carried over from an old CRM can predate the import; only waits measured here count
        (AVG(EXTRACT(EPOCH FROM (cc."addedAt" - c."readyAt")) / 86400) FILTER (WHERE c."readyAt" >= c."createdAt"))::float AS avg
      FROM "CampaignCompany" cc JOIN "Company" c ON c.id = cc."companyId"
      WHERE cc."addedAt" >= ${from} AND c."deletedAt" IS NULL AND c."readyAt" IS NOT NULL AND cc."addedAt" >= c."readyAt"`,

    // Callers
    db.$queryRaw<{ ownerId: string | null; dials: number; talks: number; meetings: number; days: number }[]>`
      SELECT a."ownerId", COUNT(*)::int AS dials,
        COUNT(*) FILTER (WHERE a."callResult" = ANY(${CONVERSATION_OUTCOMES}::text[]))::int AS talks,
        COUNT(*) FILTER (WHERE a."callResult" = 'Meeting Booked')::int AS meetings,
        COUNT(DISTINCT DATE(a."occurredAt" AT TIME ZONE 'Asia/Dhaka'))::int AS days
      FROM "Activity" a
      WHERE a."type" = 'CALL' AND a."deletedAt" IS NULL AND a."occurredAt" >= ${from} AND a."occurredAt" <= now() ${campaignSql}
      GROUP BY a."ownerId" ORDER BY dials DESC`,
    db.$queryRaw<{ result: string | null; n: number }[]>`
      SELECT a."callResult" AS result, COUNT(*)::int AS n FROM "Activity" a
      WHERE a."type" = 'CALL' AND a."deletedAt" IS NULL AND a."occurredAt" >= ${from} AND a."occurredAt" <= now() ${campaignSql}
      GROUP BY a."callResult" ORDER BY n DESC`,
    db.$queryRaw<{ day: string; dials: number; talks: number; meetings: number }[]>`
      SELECT to_char(DATE(a."occurredAt" AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM-DD') AS day, COUNT(*)::int AS dials,
        COUNT(*) FILTER (WHERE a."callResult" = ANY(${CONVERSATION_OUTCOMES}::text[]))::int AS talks,
        COUNT(*) FILTER (WHERE a."callResult" = 'Meeting Booked')::int AS meetings
      FROM "Activity" a
      WHERE a."type" = 'CALL' AND a."deletedAt" IS NULL AND a."occurredAt" >= ${new Date(now - seriesDays * dayMs)} AND a."occurredAt" <= now() ${campaignSql}
      GROUP BY 1 ORDER BY 1`,
    db.user.findMany({ select: { id: true, name: true, email: true } }),
    db.campaign.findMany({ where: { audience: { in: ["COMPANY", "CONTACT"] } }, select: { id: true, name: true, status: true }, orderBy: { updatedAt: "desc" }, take: 60 }),
  ]);

  const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.email ?? "Unknown") : "Unassigned");
  const len = names.length;

  // Cohort by source: sourced → ready → in campaign → connected → meeting → client
  const idx = (s: string) => names.indexOf(s) + 1;
  const milestones = [
    { key: "ready", label: "Ready to call", stage: STAGE.callable },
    { key: "campaign", label: "In campaign", stage: STAGE.inCampaign },
    { key: "connected", label: "Connected", stage: STAGE.connected },
    { key: "meeting", label: "Meeting", stage: STAGE.meeting },
    { key: "opportunity", label: "Opportunity", stage: STAGE.opportunity },
    { key: "client", label: "Client", stage: STAGE.customer },
  ].filter((m) => idx(m.stage) > 0);
  const bySource = new Map<string, Record<string, number>>();
  for (const row of cohortRows) {
    const s = bySource.get(row.src) ?? { sourced: 0, ...Object.fromEntries(milestones.map((m) => [m.key, 0])) };
    s.sourced += int(row.n);
    for (const m of milestones) if (int(row.r) >= idx(m.stage)) s[m.key] += int(row.n);
    bySource.set(row.src, s);
  }
  const cohortTotal = { sourced: 0, ...Object.fromEntries(milestones.map((m) => [m.key, 0])) } as Record<string, number>;
  for (const s of bySource.values()) for (const k of Object.keys(cohortTotal)) cohortTotal[k] += s[k];

  // Research: per researcher
  const per = new Map<string, { researched: number; viable: number; notViable: number; ready: number }>();
  const get = (id: string | null) => {
    const k = id ?? "";
    if (!per.has(k)) per.set(k, { researched: 0, viable: 0, notViable: 0, ready: 0 });
    return per.get(k)!;
  };
  for (const r of researched) get(r.researcherId).researched += r._count._all;
  for (const e of researchEvents) {
    const p = get(e.userId);
    if (e.toStage === STAGE.viable) p.viable += e._count._all;
    if (e.toStage === STAGE.notViable) p.notViable += e._count._all;
    if (e.toStage === STAGE.callable) p.ready += e._count._all;
  }

  // Fill missing days so the daily chart has no gaps
  const byDay = new Map(series.map((s) => [s.day, s]));
  const days = Array.from({ length: seriesDays }, (_, i) => {
    const d = new Date(now - (seriesDays - 1 - i) * dayMs);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
    const s = byDay.get(key);
    return { day: key, dials: int(s?.dials), talks: int(s?.talks), meetings: int(s?.meetings) };
  });

  return {
    generatedAt: new Date().toISOString(),
    stages: path.map((p) => ({ value: p.value, color: p.color ?? null })),
    exits: exits.map((p) => ({ value: p.value, color: p.color ?? null })),
    funnel: reachedCounts(activeRows, len),
    nowAt: nowRows.map((r) => ({ stage: r.stage ?? "No stage", n: int(r.n) })),
    sources: sources.map((s) => ({ value: s.source ?? NONE, count: s._count._all })),
    cohort: {
      milestones: milestones.map((m) => ({ key: m.key, label: m.label })),
      total: cohortTotal,
      bySource: [...bySource.entries()].map(([src, counts]) => ({ source: src, counts })).sort((a, b) => b.counts.sourced - a.counts.sourced),
    },
    research: {
      intake,
      intakeBySource: intakeBySource.map((s) => ({ label: s.source ?? NONE, n: s._count._all })),
      intakeByBatch: intakeByBatch.map((s) => ({ label: s.batchNumber ?? NONE, n: s._count._all })),
      columns: Object.fromEntries(researchCols.map((r) => [r.col, int(r.n)])) as Record<string, number>,
      researchers: [...per.entries()].map(([id, v]) => ({ name: userName(id || null), ...v })).sort((a, b) => b.researched + b.ready - (a.researched + a.ready)),
      avgDaysToReady: toReady[0]?.avg ?? null,
      readied: int(toReady[0]?.n),
    },
    handover: { pool: poolSize, wait7, wait30, readied, sent: int(sent[0]?.n), avgWait: sent[0]?.avg ?? null },
    callers: callers.map((c) => ({ name: userName(c.ownerId), dials: int(c.dials), talks: int(c.talks), meetings: int(c.meetings), days: int(c.days) })),
    outcomes: outcomes.map((o) => ({ label: o.result ?? "No outcome", n: int(o.n) })),
    series: days,
    campaigns,
  };
}

/** Cached for 5 minutes per filter combination. */
export async function loadDashboard(sp: DashboardSearchParams) {
  const period = PERIODS.some((p) => p.value === sp.period) ? sp.period! : "30";
  const source = sp.source ?? "";
  const campaign = sp.campaign ?? "";
  const data = await unstable_cache(() => compute(period, source, campaign), ["dashboard", period, source, campaign], { revalidate: 300, tags: ["dashboard"] })();
  return { ...data, filters: { tab: sp.tab ?? "funnel", period, source, campaign } };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
