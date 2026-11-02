// Intake API: lead generation tools post companies (with their people) as JSON. Each company becomes one or more
// import rows (one per person) and goes through the same engine as file imports: duplicate check by domain or name,
// fill-only updates, lead source and batch tags, and the Research Queue with researchers assigned evenly.
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { runRows, type ImportRow, type JobMapping } from "./import-core";
import { CONTACT_PROP_PREFIX, DYN_CALLER_NOTES, DYN_DESCRIPTION, importTargets, suggestTarget, type ImportOptions, type ImportRowResult, type ImportTarget } from "./import-shared";
import { getPropDefs } from "./properties";

export const MAX_COMPANIES = 500;
export const KEY_PREFIX = "ecrm_";

export function newApiKey() {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 6), hash: hashKey(key) };
}

export const hashKey = (key: string) => createHash("sha256").update(key.trim()).digest("hex");

/** The active key for an `Authorization: Bearer …` (or `X-API-Key`) header, or null. */
export async function keyFromRequest(req: Request) {
  const raw = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!raw?.startsWith(KEY_PREFIX)) return null;
  const key = await db.apiKey.findUnique({ where: { hash: hashKey(raw) } });
  return key && !key.revokedAt ? key : null;
}

type Json = Record<string, unknown>;
const PEOPLE_KEYS = ["people", "contacts", "persons", "leads"];
const PERSON_KEYS = ["person", "contact", "lead"];
// Fields that would replay Dynamics history: only file imports of Dynamics exports use them
const BLOCKED = new Set<ImportTarget>([DYN_DESCRIPTION, DYN_CALLER_NOTES]);

/** "companyName" / "company_name" → "company Name" / "company name", so field names match like column headers. */
const words = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ");

function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(cell).filter(Boolean).join("; ") || null;
  if (typeof v === "object") return null;
  return String(v);
}

export interface IntakeResult {
  received: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** One per company, in the order sent */
  results: { index: number; action: ImportRowResult["action"]; id?: string; message?: string }[];
  /** Field names that didn't match a company or person property */
  ignoredFields: string[];
}

export async function runIntake(
  body: unknown,
  key: { id: string; name: string; source: string | null; researcherIds: string[]; addMissingOptions: boolean; createdById: string; useCount: number },
  dryRun: boolean,
): Promise<IntakeResult> {
  const b = (body ?? {}) as Json;
  const list: unknown[] = Array.isArray(body) ? body : Array.isArray(b.companies) ? b.companies : b.company ? [b.company] : [b];
  const companies = list.filter((c): c is Json => !!c && typeof c === "object" && !Array.isArray(c));
  if (!companies.length) throw new Error('Send a company object, an array of companies, or { "companies": [...] }');
  if (companies.length > MAX_COMPANIES) throw new Error(`Send at most ${MAX_COMPANIES} companies per request`);

  const [companyDefs, contactDefs] = await Promise.all([getPropDefs("COMPANY"), getPropDefs("CONTACT")]);
  const companyTargets = importTargets("COMPANY", companyDefs, contactDefs).filter((t) => !BLOCKED.has(t.value));
  const personTargets = importTargets("CONTACT", contactDefs).filter((t) => t.value.startsWith("prop:"));

  // Columns: every company field seen, then every person field (as the row's lead person)
  const headers: string[] = [];
  const columns: ImportTarget[] = [];
  const index = new Map<string, number>();
  const ignored = new Set<string>();
  // Tools name fields differently ("name" vs "companyName"), so several fields may fill one property
  const free = new Set<string>();
  const column = (header: string, target: ImportTarget) => {
    index.set(header, headers.length);
    headers.push(header);
    columns.push(target);
  };
  const people = (c: Json): Json[] => {
    const many = PEOPLE_KEYS.map((k) => c[k]).find(Array.isArray) as unknown[] | undefined;
    const one = PERSON_KEYS.map((k) => c[k]).find((v) => v && typeof v === "object" && !Array.isArray(v));
    return [...(many ?? []), ...(one ? [one] : [])].filter((p): p is Json => !!p && typeof p === "object" && !Array.isArray(p));
  };
  for (const c of companies) {
    for (const k of Object.keys(c)) {
      if (index.has(k) || PEOPLE_KEYS.includes(k) || PERSON_KEYS.includes(k)) continue;
      const t = suggestTarget(words(k), companyTargets, "COMPANY", free);
      column(k, t.startsWith(CONTACT_PROP_PREFIX) ? "skip" : t);
      if (t === "skip" || t.startsWith(CONTACT_PROP_PREFIX)) ignored.add(k);
    }
    for (const p of people(c)) {
      for (const k of Object.keys(p)) {
        const h = `person.${k}`;
        if (index.has(h)) continue;
        const t = suggestTarget(words(k), personTargets, "CONTACT", free);
        const target = t.startsWith("prop:") ? `${CONTACT_PROP_PREFIX}${t.slice(5)}` : "skip";
        column(h, companyTargets.some((x) => x.value === target) ? target : "skip");
        if (columns[columns.length - 1] === "skip") ignored.add(h);
      }
    }
  }
  if (!columns.some((t) => t === "prop:name" || t === "prop:domain")) throw new Error('Each company needs a "name" or "domain" (website)');

  // One row per person; a company without people is one row. Later rows of the same company match it by domain or name.
  const rows: ImportRow[] = [];
  const rowCompany: number[] = [];
  const base = key.useCount * MAX_COMPANIES; // researchers rotate across requests, not just within one
  companies.forEach((c, i) => {
    const company = new Array<string | null>(headers.length).fill(null);
    for (const [k, v] of Object.entries(c)) if (index.has(k)) company[index.get(k)!] = cell(v);
    const ps = people(c);
    for (const p of ps.length ? ps : [null]) {
      const cells = [...company];
      if (p) for (const [k, v] of Object.entries(p)) if (index.has(`person.${k}`)) cells[index.get(`person.${k}`)!] = cell(v);
      rows.push({ row: base + rows.length, cells });
      rowCompany.push(i);
    }
  });
  if (rows.length > MAX_COMPANIES * 2) throw new Error(`Too many people in one request (at most ${MAX_COMPANIES * 2} company–person rows)`);

  const day = new Date().toISOString().slice(0, 10);
  const options: ImportOptions = {
    mode: "upsert",
    ownerId: null,
    source: cell(b.source) ?? key.source,
    batchNumber: (cell(b.batch) ?? `${day} API ${key.name}`).slice(0, 40).trim(),
    addMissingOptions: key.addMissingOptions,
    segmentName: null,
    dynamicsTimeZone: "workspace",
    researcherIds: key.researcherIds,
  };
  if (options.researcherIds?.length) {
    const active = await db.user.findMany({ where: { id: { in: options.researcherIds }, isActive: true }, select: { id: true } });
    options.researcherIds = options.researcherIds.filter((id) => active.some((u) => u.id === id));
  }
  const mapping: JobMapping = { headers, columns, options, segmentId: null };
  const results: ImportRowResult[] = [];
  for (let i = 0; i < rows.length; i += MAX_COMPANIES) {
    const res = await runRows("COMPANY", mapping, rows.slice(i, i + MAX_COMPANIES), key.createdById, `API – ${key.name}`, dryRun);
    results.push(...res.results);
  }

  // A company's result is its first row's, unless a later row (another person) failed
  const perCompany = companies.map((_, i) => {
    const mine = results.filter((_, r) => rowCompany[r] === i);
    const failed = mine.find((r) => r.action === "error");
    const first = mine[0];
    return { index: i, action: failed && first?.action !== "error" ? first.action : (first?.action ?? "error"), id: first?.id, message: [...new Set(mine.map((r) => r.message).filter(Boolean))].join("; ") || undefined };
  });
  const count = (a: ImportRowResult["action"]) => perCompany.filter((r) => r.action === a).length;
  const out: IntakeResult = {
    received: companies.length,
    created: count("created"),
    updated: count("updated"),
    skipped: count("skipped"),
    errors: count("error"),
    results: perCompany,
    ignoredFields: [...ignored],
  };
  if (!dryRun) await record(key, options.batchNumber!, out);
  return out;
}

/** Usage on the key, and one import history entry per key per day (tools often post one company at a time). */
async function record(key: { id: string; name: string; createdById: string }, batch: string, r: IntakeResult) {
  const fileName = `API · ${key.name} · ${new Date().toISOString().slice(0, 10)}`;
  const totals = { created: r.created, updated: r.updated, skipped: r.skipped, errors: r.errors, totalRows: r.received };
  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), useCount: { increment: 1 } } });
  const job = await db.importJob.findFirst({ where: { fileName, objectType: "COMPANY" }, orderBy: { createdAt: "desc" } });
  if (!job) {
    await db.importJob.create({
      data: { objectType: "COMPANY", fileName, status: "completed", mapping: { headers: [], columns: [], options: { batchNumber: batch }, segmentId: null }, summary: { ...totals, requests: 1 }, userId: key.createdById },
    });
    return;
  }
  const prev = (job.summary ?? {}) as Record<string, number>;
  const sum = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, (prev[k] ?? 0) + v]));
  await db.importJob.update({ where: { id: job.id }, data: { summary: { ...sum, requests: (prev.requests ?? 0) + 1 } as Prisma.InputJsonValue } });
}
