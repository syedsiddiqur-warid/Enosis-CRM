"use server";

// CSV / Excel import of contacts and companies: column mapping, validation (dry run), saved mapping templates
// and import history. Rows arrive from the browser in chunks; import-core.ts does the work.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { COMPANY_PROP_PREFIX, DYN_DESCRIPTION, type ImportChunkResult, type ImportObject, type ImportOptions, type ImportTarget } from "./import-shared";
import { canImport, fail, json, runRows, type ImportRow, type JobMapping, type Result } from "./import-core";

export type { ImportRow };

// ── Actions ──

export interface ImportSetup {
  object: ImportObject;
  fileName: string;
  headers: string[];
  columns: ImportTarget[];
  options: ImportOptions;
  totalRows: number;
}

function checkSetup(s: ImportSetup) {
  if (s.object !== "CONTACT" && s.object !== "COMPANY") throw new Error("Unsupported object");
  if (s.columns.length !== s.headers.length) throw new Error("Every column needs a mapping");
  const mapped = s.columns.filter((c) => c !== "skip");
  if (!mapped.length) throw new Error("Map at least one column");
  const dupes = mapped.filter((c, i) => c !== "phones" && c !== "note" && mapped.indexOf(c) !== i);
  if (dupes.length) throw new Error("Two columns are mapped to the same property");
  if (s.object === "CONTACT" && !mapped.some((c) => ["prop:email", "prop:firstName", "prop:lastName"].includes(c))) throw new Error("Map a first name, last name or email column");
  if (s.object === "CONTACT" && mapped.some((c) => c.startsWith(COMPANY_PROP_PREFIX)) && !mapped.some((c) => c === "company:name" || c === "company:domain")) {
    throw new Error("Map a Company name or Company domain column so the company columns know which company to fill");
  }
  if (s.options.dynamicsTimeZone !== "workspace" && s.options.dynamicsTimeZone !== "company") s.options.dynamicsTimeZone = "workspace";
  if (mapped.includes(DYN_DESCRIPTION) && mapped.filter((c) => c === DYN_DESCRIPTION).length > 1) throw new Error("Map only one Description column");
  if (s.object === "COMPANY" && !mapped.some((c) => ["prop:name", "prop:domain"].includes(c))) throw new Error("Map a company name or domain column");
}

/** Dry run on a chunk: what would happen to each row, without writing anything. */
export async function validateImport(setup: ImportSetup, rows: ImportRow[]): Promise<Result<ImportChunkResult>> {
  try {
    const user = await requireUser();
    await canImport(user.id);
    checkSetup(setup);
    return { ok: true, data: await runRows(setup.object, { headers: setup.headers, columns: setup.columns, options: setup.options, segmentId: null }, rows, user.id, setup.fileName, true) };
  } catch (e) {
    return fail(e);
  }
}

export async function startImport(setup: ImportSetup): Promise<Result<{ jobId: string; segmentId: string | null }>> {
  try {
    const user = await requireUser();
    await canImport(user.id);
    checkSetup(setup);
    if (setup.options.researcherIds?.length) {
      const active = await db.user.findMany({ where: { id: { in: setup.options.researcherIds }, isActive: true }, select: { id: true } });
      setup.options.researcherIds = setup.options.researcherIds.filter((id) => active.some((u) => u.id === id));
    }
    // Every import is a batch: without one, tag it with the date and file so reports can follow it to clients
    if (!setup.options.batchNumber?.trim()) {
      const base = setup.fileName.replace(/\.[^.]+$/, "").trim();
      setup.options.batchNumber = `${new Date().toISOString().slice(0, 10)} ${base}`.slice(0, 40).trim();
    }
    let segmentId: string | null = null;
    const segName = setup.options.segmentName?.trim();
    if (segName) {
      const seg = await db.segment.create({ data: { name: segName.slice(0, 100), objectType: setup.object, type: "STATIC", ownerId: user.id } });
      segmentId = seg.id;
    }
    const mapping: JobMapping = { headers: setup.headers, columns: setup.columns, options: setup.options, segmentId };
    const job = await db.importJob.create({
      data: { objectType: setup.object, fileName: setup.fileName.slice(0, 200), status: "running", mapping: json(mapping), summary: json({ totalRows: setup.totalRows }), userId: user.id },
    });
    return { ok: true, data: { jobId: job.id, segmentId } };
  } catch (e) {
    return fail(e);
  }
}

export async function importChunk(jobId: string, rows: ImportRow[]): Promise<Result<ImportChunkResult>> {
  try {
    const user = await requireUser();
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.userId !== user.id) throw new Error("This import belongs to someone else");
    if (job.status !== "running") throw new Error("This import has finished");
    const res = await runRows(job.objectType as ImportObject, job.mapping as unknown as JobMapping, rows, user.id, `Import – ${job.fileName}`, false);
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

export async function finishImport(jobId: string, summary: { created: number; updated: number; skipped: number; errors: number; addedOptions: number; cancelled?: boolean }): Promise<Result> {
  try {
    const user = await requireUser();
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.userId !== user.id) throw new Error("This import belongs to someone else");
    const prev = (job.summary ?? {}) as Prisma.JsonObject;
    await db.importJob.update({ where: { id: jobId }, data: { status: summary.cancelled ? "cancelled" : summary.errors && !summary.created && !summary.updated ? "failed" : "completed", summary: json({ ...prev, ...summary }) } });
    await db.auditLog.create({ data: { objectType: job.objectType, action: "import", changes: json({ jobId, fileName: job.fileName, ...summary }), userId: user.id } });
    revalidatePath(job.objectType === "CONTACT" ? "/contacts" : "/companies", "layout");
    revalidatePath("/settings/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Saved mapping templates ──

export async function saveImportTemplate(object: ImportObject, name: string, mapping: Record<string, ImportTarget>): Promise<Result<{ id: string }>> {
  try {
    await requireUser();
    const n = name.trim();
    if (!n) throw new Error("Name the template");
    const existing = await db.importMappingTemplate.findFirst({ where: { objectType: object, name: n } });
    const row = existing
      ? await db.importMappingTemplate.update({ where: { id: existing.id }, data: { mapping: json(mapping) } })
      : await db.importMappingTemplate.create({ data: { objectType: object, name: n.slice(0, 100), mapping: json(mapping) } });
    revalidatePath("/settings/import");
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteImportTemplate(id: string): Promise<Result> {
  try {
    await requireUser();
    await db.importMappingTemplate.delete({ where: { id } });
    revalidatePath("/settings/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
