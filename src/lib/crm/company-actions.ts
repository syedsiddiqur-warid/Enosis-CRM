"use server";

// Company-level workflows: lead journey moves, buying signals, research intake and board, enrichment.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { enrichCompany, integrationState, isConfigured, provider } from "./integrations";
import { JOURNEY_PROPERTY, STAGE, isExit } from "./journey";
import { getPropDefs } from "./properties";
import { applyUpdate } from "./record-writes";
import type { ResearchColumn } from "./research";
import { createSignal, refreshSignalRollup, type SignalInput } from "./signals";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

function revalidateCompany(id?: string) {
  revalidatePath("/companies", "layout");
  revalidatePath("/research");
  if (id) revalidatePath(`/companies/${id}`);
}

// ── Lead journey ──

/** Move a company to any journey stage by hand. Exit stages need a reason. */
export async function moveJourneyStage(companyId: string, stage: string, reason?: string): Promise<Result> {
  try {
    const user = await requireUser();
    const options = (await getPropDefs("COMPANY")).find((d) => d.name === JOURNEY_PROPERTY)?.options ?? [];
    if (!options.some((o) => o.value === stage)) throw new Error("Unknown journey stage");
    if (isExit(stage, options) && !reason?.trim()) throw new Error(`Say why the company is moving to ${stage}`);
    const changed = await applyUpdate("COMPANY", companyId, JOURNEY_PROPERTY, stage, user.id, { journey: { source: "manual", reason: reason?.trim() || null } });
    if (changed && reason?.trim() && isExit(stage, options)) {
      const co = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { properties: true } });
      await db.company.update({ where: { id: companyId }, data: { properties: { ...((co.properties ?? {}) as Prisma.JsonObject), disqualifyReason: reason.trim() } } });
    }
    // Won or lost: callers stop working it in their campaigns
    if (changed && (stage === STAGE.customer || stage === STAGE.disqualified)) {
      await db.campaignCompany.updateMany({
        where: { companyId, removedAt: null, status: { notIn: ["Completed", "Disqualified"] } },
        data: { status: stage === STAGE.customer ? "Completed" : "Disqualified", nextActionAt: null },
      });
    }
    revalidateCompany(companyId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Buying signals ──

export async function addSignal(companyId: string, input: SignalInput): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const { signal, created } = await createSignal(companyId, input, user.id);
    if (!created) throw new Error("That signal is already logged");
    revalidateCompany(companyId);
    return { ok: true, data: { id: signal.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSignal(id: string): Promise<Result<SignalInput & { companyId: string }>> {
  try {
    await requireUser();
    const s = await db.buyingSignal.delete({ where: { id } });
    await refreshSignalRollup(s.companyId);
    revalidateCompany(s.companyId);
    return {
      ok: true,
      data: { companyId: s.companyId, type: s.type, title: s.title, detail: s.detail, url: s.url, source: s.source, strength: s.strength, detectedAt: s.detectedAt.toISOString(), expiresAt: s.expiresAt?.toISOString() ?? null },
    };
  } catch (e) {
    return fail(e);
  }
}

// ── Research intake: bring sourced companies into the CRM ──

export interface IntakeInput {
  /** One company per line: "Name, domain", "domain", or a URL */
  lines: string;
  source: string;
  listSource?: string | null;
  batchNumber?: string | null;
  researcherId?: string | null;
}

export interface IntakeResult {
  created: { id: string; name: string; domain: string | null }[];
  duplicates: { line: string; id: string; name: string }[];
  invalid: string[];
  enriched: number;
}

function parseLine(line: string): { name: string | null; domain: string | null } | null {
  const parts = line.split(/[,\t;|]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const domainOf = (s: string) => {
    const m = s
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#\s]/)[0];
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(m) ? m : null;
  };
  const domainPart = parts.find((p) => domainOf(p));
  const domain = domainPart ? domainOf(domainPart) : null;
  const name = parts.find((p) => p !== domainPart && /[\p{L}\p{N}]/u.test(p)) ?? null;
  if (!name && !domain) return null;
  return { name, domain };
}

const titleFromDomain = (d: string) =>
  d
    .split(".")[0]
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export async function intakeCompanies(input: IntakeInput): Promise<Result<IntakeResult>> {
  try {
    const user = await requireUser();
    if (!input.source) throw new Error("Choose where these companies were sourced from");
    const rows = input.lines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!rows.length) throw new Error("Paste at least one company");
    if (rows.length > 500) throw new Error("Paste up to 500 companies at a time. For more, use Import CSV / Excel");

    const out: IntakeResult = { created: [], duplicates: [], invalid: [], enriched: 0 };
    const seen = new Set<string>();
    for (const line of rows) {
      const parsed = parseLine(line);
      if (!parsed) {
        out.invalid.push(line);
        continue;
      }
      const key = parsed.domain ?? parsed.name!.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Dedupe on domain, then on exact name when there's no domain
      const existing = parsed.domain
        ? await db.company.findFirst({ where: { domain: parsed.domain }, select: { id: true, name: true } })
        : await db.company.findFirst({ where: { name: { equals: parsed.name!, mode: "insensitive" }, deletedAt: null }, select: { id: true, name: true } });
      if (existing) {
        out.duplicates.push({ line, ...existing });
        continue;
      }
      const company = await db.company.create({
        data: {
          name: parsed.name ?? titleFromDomain(parsed.domain!),
          domain: parsed.domain,
          source: input.source,
          listSource: input.listSource || null,
          batchNumber: input.batchNumber?.trim() || null,
          researcherId: input.researcherId || null,
          researchStatus: "Not started",
          leadState: STAGE.sourced,
          leadStateAt: new Date(),
          createdById: user.id,
          journeyEvents: { create: { toStage: STAGE.sourced, source: "sourcing", userId: user.id, reason: `Sourced from ${input.source}${input.batchNumber ? ` (batch ${input.batchNumber.trim()})` : ""}` } },
          activities: {
            create: { activity: { create: { type: "SYSTEM", ownerId: user.id, systemData: { kind: "created", source: `Research intake – ${input.source}` } } } },
          },
        },
        select: { id: true, name: true, domain: true },
      });
      out.created.push(company);
    }

    // Optional automatic enrichment from connected APIs
    for (const p of ["apollo", "lusha"]) {
      const info = provider(p)!;
      const state = await integrationState(p);
      if (!state.enabled || !state.settings.autoEnrichOnCreate || !isConfigured(info)) continue;
      for (const c of out.created.filter((c) => c.domain).slice(0, 25)) {
        try {
          if ((await enrichCompany(c.id, p, user.id)).status === "updated") out.enriched++;
        } catch {
          // Logged on the enrichment run; intake still succeeds
        }
      }
    }
    await db.auditLog.create({ data: { objectType: "COMPANY", action: "intake", changes: { source: input.source, created: out.created.length, duplicates: out.duplicates.length }, userId: user.id } });
    revalidateCompany();
    return { ok: true, data: out };
  } catch (e) {
    return fail(e);
  }
}

// ── Research board ──

/** Dropping a card on a research board column sets the research properties; the journey follows from them. */
async function moveOne(companyId: string, column: ResearchColumn, userId: string) {
  const set = (p: string, v: unknown) => applyUpdate("COMPANY", companyId, p, v, userId);
  const co = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { researchStatus: true, researcherId: true } });
  if (!co.researcherId && column !== "to_research") await set("researcherId", userId);
  switch (column) {
    case "to_research":
      await set("researchStatus", "Not started");
      break;
    case "researching":
      await set("researchStatus", "In progress");
      break;
    case "researched":
      await set("researchStatus", "Done");
      break;
    case "viable":
      if (co.researchStatus !== "Done") await set("researchStatus", "Done");
      await set("viable", "Yes");
      break;
    case "callable":
      if (co.researchStatus !== "Done") await set("researchStatus", "Done");
      await set("viable", "Yes");
      await set("callable", "Yes");
      break;
    case "not_viable":
      if (co.researchStatus !== "Done") await set("researchStatus", "Done");
      await set("viable", "No");
      break;
  }
}

export async function moveResearchCard(companyId: string, column: ResearchColumn): Promise<Result> {
  try {
    const user = await requireUser();
    await moveOne(companyId, column, user.id);
    revalidateCompany(companyId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Move a batch of companies (the client sends large selections in chunks and shows progress). */
export async function moveResearchCards(ids: string[], column: ResearchColumn): Promise<Result<{ moved: number; failed: number; reasons: string[] }>> {
  try {
    const user = await requireUser();
    if (ids.length > 100) throw new Error("Send at most 100 companies per request");
    let moved = 0;
    let failed = 0;
    // Why moves failed (e.g. the ready-to-call checklist), counted so the board can say what to fix
    const why = new Map<string, number>();
    // A few at a time: each move writes several fields, an audit row and the journey
    for (let i = 0; i < ids.length; i += 4) {
      const results = await Promise.allSettled(ids.slice(i, i + 4).map((id) => moveOne(id, column, user.id)));
      for (const r of results) {
        if (r.status === "fulfilled") moved++;
        else {
          failed++;
          const m = r.reason instanceof Error ? r.reason.message : "Something went wrong";
          why.set(m, (why.get(m) ?? 0) + 1);
        }
      }
    }
    revalidateCompany();
    const reasons = [...why].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} (${n})`);
    return { ok: true, data: { moved, failed, reasons } };
  } catch (e) {
    return fail(e);
  }
}

// ── Enrichment ──

export async function enrichCompanyAction(companyId: string, providerId: string): Promise<Result<{ status: string; changed: number; signals: number }>> {
  try {
    const user = await requireUser();
    const state = await integrationState(providerId);
    if (!state.enabled) throw new Error(`${provider(providerId)?.name ?? providerId} is turned off in Settings → Integrations`);
    const res = await enrichCompany(companyId, providerId, user.id);
    revalidateCompany(companyId);
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

export async function setIntegration(providerId: string, patch: { enabled?: boolean; settings?: Record<string, boolean> }): Promise<Result> {
  try {
    const user = await requireUser();
    const me = await db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } });
    if (me?.role?.name !== "Admin") throw new Error("Only admins can change integrations");
    const p = provider(providerId);
    if (!p || p.kind !== "api") throw new Error("This source has no API connector");
    const current = await integrationState(providerId);
    const settings = { ...current.settings, ...(patch.settings ?? {}) };
    await db.integration.upsert({
      where: { provider: providerId },
      create: { provider: providerId, enabled: patch.enabled ?? false, settings },
      update: { ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), settings },
    });
    await db.auditLog.create({ data: { action: "settings", changes: { integration: providerId, ...patch }, userId: user.id } });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
