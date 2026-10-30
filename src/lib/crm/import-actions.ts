"use server";

// CSV / Excel import of contacts and companies: column mapping, validation (dry run), de-duplication,
// company linking, saved mapping templates and import history. Rows arrive from the browser in chunks.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { fromLocalInput } from "./dates";
import { parseDynamics, type DynamicsParsed } from "./dynamics-parser";
import { normalizeCountry, normalizeRegion, timeZoneFor } from "./geo";
import {
  COMPANY_PROP_PREFIX,
  CONTACT_PROP_PREFIX,
  DYN_CALLER_NOTES,
  DYN_DESCRIPTION,
  NOT_IMPORTABLE,
  OPTION_ALIASES,
  type ImportChunkResult,
  type ImportObject,
  type ImportOptions,
  type ImportRowResult,
  type ImportTarget,
} from "./import-shared";
import { STAGE, stageForCall } from "./journey";
import { getPropDefs } from "./properties";
import { advanceJourney } from "./record-writes";
import { recomputeCallRollups } from "./rollups";
import type { PropDef, PropOption } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const json = (v: unknown) => v as Prisma.InputJsonValue;

const MAX_CHUNK = 500;

async function canImport(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  const perms = (u?.role?.permissions ?? {}) as { contacts?: { import?: boolean } };
  if (perms.contacts?.import === false) throw new Error("Your role can't import records");
}

// ── Value parsing ──

export interface ImportRow {
  /** 1-based spreadsheet row number (header is row 1) */
  row: number;
  cells: (string | null)[];
  /** Parsed Dynamics items (keys like "t0", "n1", "c2", "o0", "u") the reviewer unticked */
  exclude?: string[];
}

function normalizeDomain(v: string) {
  return (
    v
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#\s]/)[0] || null
  );
}

function normalizePhone(v: string) {
  const t = v.trim();
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  if (t.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return t;
}

function parseDate(raw: string, withTime: boolean): Date {
  const s = raw.trim();
  const bad = () => new Error(`"${s}" isn't a date (use YYYY-MM-DD)`);
  const check = (y: string, mo: string, d: string, h = "0", mi = "0") => {
    const [Y, M, D, H, Mi] = [y, mo, d, h, mi].map(Number);
    const days = new Date(Date.UTC(Y, M, 0)).getUTCDate(); // days in that month
    if (M < 1 || M > 12 || D < 1 || D > days || H > 23 || Mi > 59) throw bad();
  };
  // Spreadsheet wall-clock times are Asia/Dhaka, like everything else typed into the CRM
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) check(m[1], m[2], m[3], m[4], m[5]);
  if (m) return new Date(fromLocalInput(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${(m[4] ?? (withTime ? "00" : "12")).padStart(2, "0")}:${m[5] ?? "00"}`));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i);
  if (m) {
    check(m[3], m[1], m[2], m[4], m[5]);
    let h = Number(m[4] ?? (withTime ? 0 : 12));
    if (m[6]?.toUpperCase() === "PM" && h < 12) h += 12;
    if (m[6]?.toUpperCase() === "AM" && h === 12) h = 0;
    return new Date(fromLocalInput(`${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[5] ?? "00"}`));
  }
  const d = new Date(s); // ISO from Excel cells (the browser converts them) and other unambiguous formats
  if (Number.isNaN(d.getTime())) throw bad();
  return d;
}

interface ParseContext {
  users: { id: string; name: string | null; email: string }[];
  addMissingOptions: boolean;
  /** Options added in this chunk, per property */
  added: Map<string, PropOption[]>;
  /** Same, for the other object: company properties on a contact import, the lead person on a company import */
  companyAdded: Map<string, PropOption[]>;
  /** Problems in the current row that don't stop it, e.g. an owner who isn't a CRM user yet */
  warnings: string[];
}

function matchOption(def: PropDef, raw: string, ctx: ParseContext): string {
  const v = OPTION_ALIASES[def.name]?.[raw.trim().toLowerCase()] ?? raw.trim();
  const opts = [...(def.options ?? []), ...(ctx.added.get(def.name) ?? [])];
  // "NodeJS", "Node JS" and "node.js" are the same value
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  const hit = opts.find((o) => o.value.toLowerCase() === v.toLowerCase() || o.label.toLowerCase() === v.toLowerCase()) ?? (k(v) ? opts.find((o) => k(o.value) === k(v) || k(o.label) === k(v)) : undefined);
  if (hit) return hit.value;
  if (!ctx.addMissingOptions) throw new Error(`"${v}" isn't an option (allowed: ${opts.map((o) => o.label).join(", ")})`);
  const list = ctx.added.get(def.name) ?? [];
  list.push({ value: v, label: v, order: opts.length });
  ctx.added.set(def.name, list);
  return v;
}

/** Turn a cell into the value a property stores. Throws a readable error for bad values. */
function parseValue(def: PropDef, raw: string, ctx: ParseContext): unknown {
  // "USA" → United States; states are tidied once the row's country is known (see withLocation)
  const v = def.name === "country" ? normalizeCountry(raw) : raw.trim();
  switch (def.type) {
    case "NUMBER":
    case "AUTO_NUMBER": {
      const n = Number(v.replace(/[,$%\s]/g, ""));
      if (Number.isNaN(n)) throw new Error(`"${v}" isn't a number`);
      return ["employees", "foundedYear", "crtCount", "connectedCount"].includes(def.name) ? Math.round(n) : n;
    }
    case "BOOLEAN": {
      if (/^(yes|y|true|1)$/i.test(v)) return true;
      if (/^(no|n|false|0)$/i.test(v)) return false;
      throw new Error(`"${v}" isn't Yes or No`);
    }
    case "DATE":
    case "DATETIME": {
      const d = parseDate(v, def.type === "DATETIME");
      return def.isBuiltIn ? d : def.type === "DATE" ? d.toISOString().slice(0, 10) : d.toISOString();
    }
    case "ENUM":
    case "RADIO":
      return matchOption(def, v, ctx);
    case "MULTI_ENUM":
      return [
        ...new Set(
          v
            .split(/[;|,]/)
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => matchOption(def, x, ctx)),
        ),
      ];
    case "USER": {
      const u = ctx.users.find((x) => x.email.toLowerCase() === v.toLowerCase() || x.name?.toLowerCase() === v.toLowerCase());
      // People from the old CRM who aren't users yet: keep the row, note the name
      if (!u) {
        ctx.warnings.push(`${def.label}: ${v}`);
        return undefined;
      }
      return u.id;
    }
    case "EMAIL": {
      const e = v.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`"${v}" isn't an email address`);
      return e;
    }
    case "PHONE":
      return normalizePhone(v);
    case "URL":
      return def.name === "domain" ? normalizeDomain(v) : v;
    default:
      return v;
  }
}

// ── Row import ──

const titleFromDomain = (d: string) =>
  d
    .split(".")[0]
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

interface Prepared {
  builtIn: Record<string, unknown>;
  custom: Record<string, unknown>;
  companyName: string | null;
  companyDomain: string | null;
  /** Contact imports: company properties from the same row */
  companyBuiltIn: Record<string, unknown>;
  companyCustom: Record<string, unknown>;
  /** Company imports: the lead person from the same row */
  contactBuiltIn: Record<string, unknown>;
  contactCustom: Record<string, unknown>;
  phones: string[];
  note: string | null;
  dynDescription: string | null;
  dynCallerNotes: string | null;
  /** Values that were left out, e.g. owners who aren't CRM users yet */
  warnings: string[];
}

function prepare(columns: ImportTarget[], headers: string[], cells: (string | null)[], defs: PropDef[], otherDefs: PropDef[], ctx: ParseContext): Prepared {
  const out: Prepared = {
    builtIn: {},
    custom: {},
    companyName: null,
    companyDomain: null,
    companyBuiltIn: {},
    companyCustom: {},
    contactBuiltIn: {},
    contactCustom: {},
    phones: [],
    note: null,
    dynDescription: null,
    dynCallerNotes: null,
    warnings: [],
  };
  ctx.warnings = out.warnings;
  const errors: string[] = [];
  columns.forEach((target, i) => {
    const raw = cells[i];
    if (target === "skip" || raw === null || raw === undefined || String(raw).trim() === "") return;
    const cell = String(raw);
    try {
      if (target === "company:name") out.companyName = cell.trim();
      else if (target === "company:domain") out.companyDomain = normalizeDomain(cell);
      else if (target === "phones")
        out.phones.push(
          ...cell
            .split(/[;|\n]/)
            .map((p) => normalizePhone(p))
            .filter((p): p is string => !!p),
        );
      else if (target === "note") out.note = out.note ? `${out.note}\n${cell.trim()}` : cell.trim();
      else if (target === DYN_DESCRIPTION) out.dynDescription = cell;
      else if (target === DYN_CALLER_NOTES) out.dynCallerNotes = cell;
      else if (target.startsWith(COMPANY_PROP_PREFIX) || target.startsWith(CONTACT_PROP_PREFIX)) {
        const company = target.startsWith(COMPANY_PROP_PREFIX);
        const def = otherDefs.find((d) => d.name === target.slice((company ? COMPANY_PROP_PREFIX : CONTACT_PROP_PREFIX).length));
        if (!def || def.isVirtual || NOT_IMPORTABLE.has(def.name)) return;
        // Dropdown values are matched against the other object's property options
        const value = parseValue(def, cell, { ...ctx, added: ctx.companyAdded });
        if (value === null || value === undefined) return;
        if (company) (def.isBuiltIn ? out.companyBuiltIn : out.companyCustom)[def.name] = value;
        else (def.isBuiltIn ? out.contactBuiltIn : out.contactCustom)[def.name] = value;
      } else if (target.startsWith("prop:")) {
        const def = defs.find((d) => d.name === target.slice(5));
        if (!def || def.isVirtual || NOT_IMPORTABLE.has(def.name)) return;
        const value = parseValue(def, cell, ctx);
        if (value === null || value === undefined) return;
        (def.isBuiltIn ? out.builtIn : out.custom)[def.name] = value;
      }
    } catch (e) {
      errors.push(`${headers[i] || `Column ${i + 1}`}: ${e instanceof Error ? e.message : "invalid"}`);
    }
  });
  if (errors.length) throw new Error(errors.join("; "));
  withLocation(out.builtIn);
  withLocation(out.companyBuiltIn);
  // People who aren't CRM users yet are kept on the timeline, so nothing from the old CRM is lost
  if (out.warnings.length) {
    const names = `Not matched to a CRM user: ${out.warnings.join("; ")}`;
    out.note = out.note ? `${out.note}
${names}` : names;
  }
  return out;
}

/** "TX" → Texas, and a time zone from the state/province or country when the file has none. */
function withLocation(fields: Record<string, unknown>) {
  const country = fields.country as string | undefined;
  if (typeof fields.state === "string") fields.state = normalizeRegion(country, fields.state);
  if (!fields.timeZone && (country || fields.state)) {
    const tz = timeZoneFor(country, fields.state as string | undefined);
    if (tz) fields.timeZone = tz;
  }
}

interface RunContext {
  object: ImportObject;
  defs: PropDef[];
  options: ImportOptions;
  userId: string;
  source: string;
  segmentId: string | null;
  dryRun: boolean;
  /** Call outcome values the Caller Notes parser may map results to */
  outcomes: string[];
  /** Per row: parsed Dynamics items the reviewer unticked */
  exclude: Set<string>;
}

/** Round robin by spreadsheet row, so the split is even across chunks. */
const researcherFor = (options: ImportOptions, row: number) => (options.researcherIds?.length ? options.researcherIds[row % options.researcherIds.length] : null);

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

async function findOrCreateCompany(p: Prepared, run: RunContext): Promise<string | null> {
  if (!p.companyName && !p.companyDomain) return null;
  const existing =
    (p.companyDomain ? await db.company.findFirst({ where: { domain: p.companyDomain, deletedAt: null } }) : null) ??
    (p.companyName ? await db.company.findFirst({ where: { name: { equals: p.companyName, mode: "insensitive" }, deletedAt: null } }) : null);
  if (existing) {
    // Lead rows repeat the company's data: fill what the company is missing, never overwrite it
    if (!run.dryRun) {
      const rec = existing as unknown as Record<string, unknown>;
      const fill = Object.fromEntries(Object.entries(p.companyBuiltIn).filter(([k]) => isEmpty(rec[k])));
      const props = (existing.properties ?? {}) as Prisma.JsonObject;
      const fillCustom = Object.fromEntries(Object.entries(p.companyCustom).filter(([k]) => isEmpty(props[k])));
      if (Object.keys(fill).length || Object.keys(fillCustom).length) {
        await db.company.update({ where: { id: existing.id }, data: { ...(fill as Prisma.CompanyUpdateInput), properties: json({ ...props, ...fillCustom }) } });
      }
    }
    return existing.id;
  }
  if (p.companyDomain && (await db.company.findUnique({ where: { domain: p.companyDomain }, select: { id: true } }))) {
    throw new Error(`A deleted company has the domain ${p.companyDomain}; restore it first`);
  }
  if (run.dryRun) return "new";
  const c = await db.company.create({
    data: {
      ownerId: run.options.ownerId,
      source: run.options.source,
      batchNumber: run.options.batchNumber,
      lifecycleStage: "Lead",
      leadStatus: "New",
      researchStatus: "Not started",
      ...(p.companyBuiltIn as Prisma.CompanyUncheckedCreateInput),
      name: p.companyName ?? titleFromDomain(p.companyDomain!),
      domain: p.companyDomain,
      leadState: STAGE.sourced,
      leadStateAt: new Date(),
      properties: json(p.companyCustom),
      createdById: run.userId,
      journeyEvents: { create: { toStage: STAGE.sourced, source: "import", userId: run.userId, reason: run.source } },
      activities: { create: { activity: { create: { type: "SYSTEM", ownerId: run.userId, systemData: { kind: "imported", source: run.source } } } } },
    },
  });
  return c.id;
}

async function importRow(p: Prepared, run: RunContext, row: number): Promise<{ action: ImportRowResult["action"]; id?: string; message?: string }> {
  const { object, options } = run;
  // 1. Find the existing record
  let existing: { id: string; properties: Prisma.JsonValue; leadState?: string | null } | null = null;
  if (object === "CONTACT") {
    const email = p.builtIn.email as string | undefined;
    if (!email && !p.builtIn.firstName && !p.builtIn.lastName) throw new Error("Needs a first name, last name or email");
    if (email) existing = await db.contact.findFirst({ where: { email, deletedAt: null }, select: { id: true, properties: true } });
  } else {
    const domain = p.builtIn.domain as string | undefined;
    if (!p.builtIn.name && !domain) throw new Error("Needs a company name or domain");
    // Re-imports of a Dynamics export find the company by its lead ID, even if the name or website changed
    const leadId = p.custom.dynamicsLeadId as string | undefined;
    const byLeadId = leadId
      ? await db.company.findFirst({ where: { deletedAt: null, properties: { path: ["dynamicsLeadId"], equals: leadId } }, select: { id: true, properties: true, leadState: true } })
      : null;
    if (byLeadId) existing = byLeadId;
    else if (domain) {
      const hit = await db.company.findUnique({ where: { domain }, select: { id: true, properties: true, leadState: true, deletedAt: true } });
      if (hit?.deletedAt) throw new Error(`A deleted company has the domain ${domain}; restore it first`);
      existing = hit;
    } else {
      existing = await db.company.findFirst({ where: { name: { equals: String(p.builtIn.name), mode: "insensitive" }, deletedAt: null }, select: { id: true, properties: true, leadState: true } });
    }
  }
  if (existing && options.mode === "create") return { action: "skipped", id: existing.id, message: object === "CONTACT" ? "A contact with this email already exists" : "This company already exists" };
  if (!existing && options.mode === "update") return { action: "skipped", message: "No matching record to update" };

  const companyId = object === "CONTACT" ? await findOrCreateCompany(p, run) : null;
  if (run.dryRun) return { action: existing ? "updated" : "created", id: existing?.id, message: p.warnings.length ? `not CRM users yet: ${p.warnings.join(", ")}` : undefined };

  // 2. Write
  let id: string;
  if (existing) {
    id = existing.id;
    const properties = { ...((existing.properties ?? {}) as Prisma.JsonObject), ...p.custom } as Prisma.InputJsonValue;
    if (object === "CONTACT") await db.contact.update({ where: { id }, data: { ...(p.builtIn as Prisma.ContactUpdateInput), properties } });
    else {
      const stageChanged = p.builtIn.leadState && p.builtIn.leadState !== existing.leadState;
      await db.company.update({ where: { id }, data: { ...(p.builtIn as Prisma.CompanyUpdateInput), properties, ...(stageChanged ? { leadStateAt: new Date() } : {}) } });
      if (stageChanged) {
        await db.journeyEvent.create({ data: { companyId: id, fromStage: existing.leadState ?? null, toStage: String(p.builtIn.leadState), source: "import", userId: run.userId, reason: run.source } });
      }
    }
    await db.activity.create({
      data: {
        type: "SYSTEM",
        ownerId: run.userId,
        systemData: json({ kind: "imported", source: `${run.source} (updated ${Object.keys({ ...p.builtIn, ...p.custom }).length} fields)` }),
        ...(object === "CONTACT" ? { contacts: { create: { contactId: id } } } : { companies: { create: { companyId: id } } }),
      },
    });
  } else if (object === "CONTACT") {
    const c = await db.contact.create({
      data: {
        lifecycleStage: "Lead",
        leadStatus: "New",
        callStatus: "Never Reached Targets",
        ownerId: options.ownerId,
        ...(p.builtIn as Prisma.ContactUncheckedCreateInput),
        properties: json(p.custom),
        createdById: run.userId,
        activities: { create: { activity: { create: { type: "SYSTEM", ownerId: run.userId, systemData: { kind: "imported", source: run.source } } } } },
      },
    });
    id = c.id;
  } else {
    const domain = (p.builtIn.domain as string | undefined) ?? null;
    const stage = (p.builtIn.leadState as string | undefined) ?? STAGE.sourced;
    const c = await db.company.create({
      data: {
        lifecycleStage: "Lead",
        leadStatus: "New",
        researchStatus: "Not started",
        ownerId: options.ownerId,
        researcherId: researcherFor(options, row),
        source: options.source,
        batchNumber: options.batchNumber,
        ...(p.builtIn as Prisma.CompanyUncheckedCreateInput),
        name: (p.builtIn.name as string | undefined) ?? titleFromDomain(domain!),
        leadState: stage,
        leadStateAt: new Date(),
        properties: json(p.custom),
        createdById: run.userId,
        journeyEvents: { create: { toStage: stage, source: "import", userId: run.userId, reason: run.source } },
        activities: { create: { activity: { create: { type: "SYSTEM", ownerId: run.userId, systemData: { kind: "imported", source: run.source } } } } },
      },
    });
    id = c.id;
  }

  // 3. Associations, numbers, note, segment
  if (object === "CONTACT" && companyId && companyId !== "new") {
    const link = await db.contactCompany.findUnique({ where: { contactId_companyId: { contactId: id, companyId } } });
    if (!link) {
      const hasPrimary = await db.contactCompany.count({ where: { contactId: id, isPrimary: true } });
      await db.contactCompany.create({ data: { contactId: id, companyId, isPrimary: !hasPrimary } });
    }
  }
  if (p.phones.length) {
    const owner = object === "COMPANY" ? { companyId: id } : { contactId: id, companyId: companyId && companyId !== "new" ? companyId : null };
    const have = new Set((await db.phoneNumber.findMany({ where: object === "COMPANY" ? { companyId: id } : { contactId: id }, select: { number: true } })).map((x) => x.number));
    for (const number of [...new Set(p.phones)].filter((n) => !have.has(n))) {
      await db.phoneNumber.create({ data: { number, type: object === "COMPANY" ? "Main" : "Direct", ...owner } });
    }
  }
  if (p.note && !(await db.activity.count({ where: { type: "NOTE", deletedAt: null, body: p.note, ...(object === "CONTACT" ? { contacts: { some: { contactId: id } } } : { companies: { some: { companyId: id } } }) } }))) {
    await db.activity.create({
      data: {
        type: "NOTE",
        ownerId: run.userId,
        body: p.note,
        ...(object === "CONTACT" ? { contacts: { create: { contactId: id } } } : { companies: { create: { companyId: id } } }),
      },
    });
  }
  const leadPerson = object === "COMPANY" ? await upsertLeadPerson(p, id, run) : null;
  let dynMessage: string | undefined;
  if (p.dynDescription || p.dynCallerNotes) {
    const parsed = parseDynamics(p.dynDescription, p.dynCallerNotes, run.outcomes);
    dynMessage = await applyDynamics(parsed, { recordId: id, companyId: object === "COMPANY" ? id : companyId && companyId !== "new" ? companyId : null }, run);
  }
  // Research and viability already done in the old CRM move the journey on (forward only)
  if (object === "COMPANY") {
    // Matched companies without a researcher get one too
    if (existing && options.researcherIds?.length) await db.company.updateMany({ where: { id, researcherId: null }, data: { researcherId: researcherFor(options, row) } });
    const researched = !!(p.builtIn.researchedAt || p.custom.researchResult || p.custom.viable || p.custom.callable);
    const stage = p.custom.callable === "Yes" ? STAGE.callable : p.custom.viable === "Yes" ? STAGE.viable : researched ? STAGE.researched : null;
    if (stage) await advanceJourney(id, stage, run.userId, { source: "import", reason: run.source });
    if (researched && !p.builtIn.researchStatus) await db.company.updateMany({ where: { id, researchStatus: { in: ["Not started", "In progress"] } }, data: { researchStatus: "Done" } });
  }
  if (run.segmentId) {
    await db.segmentMember.upsert({
      where: { segmentId_recordId: { segmentId: run.segmentId, recordId: id } },
      create: { segmentId: run.segmentId, recordId: id, addedById: run.userId, ...(object === "CONTACT" ? { contactId: id } : { companyId: id }) },
      update: {},
    });
  }
  const message = [leadPerson === "created" && "lead person added", dynMessage, p.warnings.length && `not CRM users yet: ${p.warnings.join(", ")}`].filter(Boolean).join(" · ");
  return { action: existing ? "updated" : "created", id, message: message || undefined };
}

/** Company imports: the row's lead person, matched by email or by name at the company, else created; linked to the company.
 *  An existing contact only gets its empty fields filled. */
async function upsertLeadPerson(p: Prepared, companyId: string, run: RunContext): Promise<"created" | "matched" | null> {
  const b = p.contactBuiltIn;
  if (!b.firstName && !b.lastName && !b.email) return null;
  const email = (b.email as string | undefined)?.toLowerCase();
  let match = email ? await db.contact.findFirst({ where: { email, deletedAt: null } }) : null;
  if (!match) {
    const atCompany = await db.contact.findMany({ where: { deletedAt: null, companies: { some: { companyId } } } });
    match = atCompany.find((c) => nameKey(c.firstName, c.lastName) === nameKey((b.firstName as string) ?? null, (b.lastName as string) ?? null)) ?? null;
  }
  let contactId: string;
  if (match) {
    const rec = match as unknown as Record<string, unknown>;
    const fill = Object.fromEntries(Object.entries(b).filter(([k]) => isEmpty(rec[k])));
    const props = (match.properties ?? {}) as Prisma.JsonObject;
    const fillCustom = Object.fromEntries(Object.entries(p.contactCustom).filter(([k]) => isEmpty(props[k])));
    if (Object.keys(fill).length || Object.keys(fillCustom).length) {
      await db.contact.update({ where: { id: match.id }, data: { ...(fill as Prisma.ContactUpdateInput), properties: json({ ...props, ...fillCustom }) } });
    }
    contactId = match.id;
  } else {
    const c = await db.contact.create({
      data: {
        lifecycleStage: "Lead",
        leadStatus: "New",
        callStatus: "Never Reached Targets",
        ownerId: run.options.ownerId,
        ...(b as Prisma.ContactUncheckedCreateInput),
        properties: json(p.contactCustom),
        createdById: run.userId,
        activities: { create: { activity: { create: { type: "SYSTEM", ownerId: run.userId, systemData: { kind: "imported", source: `${run.source} (lead person)` } } } } },
      },
    });
    contactId = c.id;
  }
  await linkToCompany(contactId, companyId);
  return match ? "matched" : "created";
}

/** Associate a contact with a company; it becomes the contact's primary company when it has none. */
async function linkToCompany(contactId: string, companyId: string) {
  if (await db.contactCompany.findUnique({ where: { contactId_companyId: { contactId, companyId } } })) return;
  const hasPrimary = await db.contactCompany.count({ where: { contactId, isPrimary: true } });
  await db.contactCompany.create({ data: { contactId, companyId, isPrimary: !hasPrimary } });
}

// ── Dynamics free text: Targets>>, Numbers>>, Caller Notes ──

/** Add dropdown values a property doesn't have yet (case-insensitive), after its existing options. */
async function addOptions(objectType: ImportObject, name: string, values: { value: string; label: string }[] | string[]) {
  const row = await db.propertyDefinition.findUnique({ where: { objectType_name: { objectType, name } } });
  if (!row) return;
  const current = (row.options as PropOption[] | null) ?? [];
  const fresh = values
    .map((v) => (typeof v === "string" ? { value: v, label: v } : v))
    .filter((o, i, all) => !current.some((c) => c.value.toLowerCase() === o.value.toLowerCase()) && all.findIndex((x) => x.value.toLowerCase() === o.value.toLowerCase()) === i)
    .map((o, i) => ({ ...o, order: current.length + i }));
  if (fresh.length) await db.propertyDefinition.update({ where: { id: row.id }, data: { options: json([...current, ...fresh]) } });
}

const nameKey = (first: string | null, last: string | null) => `${first ?? ""} ${last ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");

/** Write the parsed Description / Caller Notes of one row. `recordId` is the imported contact or company. */
async function applyDynamics(parsed: DynamicsParsed, ref: { recordId: string; companyId: string | null }, run: RunContext): Promise<string> {
  const keep = <T extends { key: string }>(items: T[]) => items.filter((i) => !run.exclude.has(i.key));
  const leadId = run.object === "CONTACT" ? ref.recordId : null;
  const { companyId } = ref;
  const counts = { contacts: 0, numbers: 0, calls: 0, notes: 0 };

  // People already at the company (and the lead person), to match names mentioned in the text
  const known = companyId
    ? await db.contact.findMany({ where: { deletedAt: null, companies: { some: { companyId } } } })
    : leadId
      ? await db.contact.findMany({ where: { id: leadId } })
      : [];
  const phones = await db.phoneNumber.findMany({
    where: companyId ? { OR: [{ companyId }, { contact: { companies: { some: { companyId } } } }] } : { contactId: leadId ?? "" },
    select: { id: true, number: true, extension: true, contactId: true, ivrPath: true },
    orderBy: { createdAt: "asc" },
  });
  // The company's own lines: a person's "O: 415…" that is one of these isn't their personal number
  const companyNumbers = new Set([...phones.filter((p) => !p.contactId).map((p) => p.number), ...keep(parsed.numbers).map((n) => n.number)]);
  const mainNumber = phones.find((p) => !p.contactId && !p.extension)?.number ?? keep(parsed.numbers)[0]?.number ?? null;
  const addPhone = async (data: { number: string; extension?: string | null; type: string; status?: string | null; ivrPath?: string | null; notes?: string | null; contactId: string | null }) => {
    if (phones.some((p) => p.number === data.number && (p.extension ?? null) === (data.extension ?? null) && (p.contactId ?? null) === data.contactId)) return;
    const row = await db.phoneNumber.create({
      data: { number: data.number, extension: data.extension ?? null, type: data.type, status: data.status ?? "Unknown", ivrPath: data.ivrPath ?? null, notes: data.notes ?? null, companyId, contactId: data.contactId },
      select: { id: true, number: true, extension: true, contactId: true, ivrPath: true },
    });
    phones.push(row);
    counts.numbers++;
  };
  const scope = companyId ? { companies: { some: { companyId } } } : { contacts: { some: { contactId: leadId ?? "" } } };
  const hasNote = async (body: string, where: Prisma.ActivityWhereInput = scope) => (await db.activity.count({ where: { type: "NOTE", deletedAt: null, body, ...where } })) > 0;

  // Targets>> → contacts (matched by any of their emails, then by name at the company; existing ones only get empty fields filled)
  for (const t of keep(parsed.targets)) {
    let match = known.find((k) => k.email && t.emails.includes(k.email.toLowerCase())) ?? known.find((k) => nameKey(k.firstName, k.lastName) === nameKey(t.firstName, t.lastName));
    if (!match && t.emails.length) match = (await db.contact.findFirst({ where: { email: { in: t.emails }, deletedAt: null } })) ?? undefined;
    // A company number with an extension ("760-943-9123 x202") is the person's own line
    const personal = t.phones.filter((ph) => !companyNumbers.has(ph.number) || ph.extension);
    const direct = personal.find((ph) => !ph.status && ph.type !== "Main") ?? personal.find((ph) => !ph.status) ?? null;
    const inDbnd = t.dbnd === "No" ? "No" : t.dbnd ? "Yes" : null;
    if (match) {
      const fill: Prisma.ContactUpdateInput = {};
      if (!match.jobTitle && t.jobTitle) fill.jobTitle = t.jobTitle;
      if (!match.email && t.email) fill.email = t.email;
      if (!match.phone && direct) fill.phone = direct.number;
      if (!match.linkedinUrl && t.linkedinUrl) fill.linkedinUrl = t.linkedinUrl;
      if (!match.inDbnd && inDbnd) fill.inDbnd = inDbnd;
      if (!match.doNotCall && t.doNotCall) fill.doNotCall = true;
      const props = (match.properties ?? {}) as Prisma.JsonObject;
      const primary = (match.email ?? t.email)?.toLowerCase();
      const others = t.emails.filter((e) => e !== primary);
      if (!props.otherEmails && others.length) fill.properties = json({ ...props, otherEmails: others.join(", ") });
      if (Object.keys(fill).length) match = await db.contact.update({ where: { id: match.id }, data: fill });
    } else {
      const c = await db.contact.create({
        data: {
          firstName: t.firstName,
          lastName: t.lastName,
          jobTitle: t.jobTitle,
          email: t.email,
          phone: direct?.number ?? null,
          linkedinUrl: t.linkedinUrl,
          inDbnd,
          doNotCall: t.doNotCall,
          ownerId: run.options.ownerId,
          lifecycleStage: "Lead",
          // Someone who has left is kept for the history but isn't a target any more
          leadStatus: t.noLonger ? "Unqualified" : "New",
          callStatus: t.doNotCall ? "Do Not Call" : "Never Reached Targets",
          properties: json(t.emails.length > 1 ? { otherEmails: t.emails.slice(1).join(", ") } : {}),
          createdById: run.userId,
          activities: { create: { activity: { create: { type: "SYSTEM", ownerId: run.userId, systemData: { kind: "imported", source: `${run.source} (Targets>>)` } } } } },
        },
      });
      match = c;
      known.push(c);
      counts.contacts++;
    }
    if (companyId) await linkToCompany(match.id, companyId);
    // Their numbers, and their extension on the main line (with the dial-by-name code)
    for (const ph of personal) await addPhone({ number: ph.number, extension: ph.extension, type: ph.type, status: ph.status, notes: ph.note, contactId: match.id });
    if (t.extension && mainNumber) {
      await addPhone({ number: mainNumber, extension: t.extension, type: "Direct", ivrPath: t.dbnd && t.dbnd !== "No" ? `DBND ${t.dbnd}` : null, contactId: match.id });
    }
    // Remarks such as "EA - Mimi" or "Not the right person" go on the person's timeline
    const remarks = [...t.remarks, ...(t.dbnd && t.dbnd !== "No" && !t.extension ? [`Dial-by-name code ${t.dbnd}`] : [])];
    if (remarks.length) {
      const body = `From Dynamics CRM: ${remarks.join("; ")}`;
      if (!(await hasNote(body, { contacts: { some: { contactId: match.id } } }))) {
        await db.activity.create({ data: { type: "NOTE", ownerId: null, body, contacts: { create: { contactId: match.id } }, ...(companyId ? { companies: { create: { companyId } } } : {}) } });
        counts.notes++;
      }
    }
  }

  /** Contact named in a piece of text: full name first, then a unique first name. */
  const mentioned = (text: string | null) => {
    if (!text) return null;
    const t = text.toLowerCase();
    const full = known.find((k) => k.firstName && k.lastName && t.includes(nameKey(k.firstName, k.lastName)));
    if (full) return full.id;
    const firsts = known.filter((k) => k.firstName && new RegExp(`\\b${k.firstName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
    return firsts.length === 1 ? firsts[0].id : null;
  };

  // Numbers>> → phone numbers on the company (or the contact when there's no company)
  for (const n of keep(parsed.numbers)) {
    if (phones.some((p) => p.number === n.number && !p.extension)) continue;
    const contactId = mentioned(n.contactHint);
    await addPhone({ number: n.number, extension: n.extension, type: n.type, ivrPath: n.ivrPath, status: n.status, notes: n.notes, contactId: contactId ?? (companyId ? null : leadId) });
  }

  // Header lines → company fields (only where the company has none), and the phone menu on the main number
  if (companyId && run.object === "COMPANY") {
    const co = await db.company.findUnique({ where: { id: companyId }, select: { servicesOrApps: true, careerPageUrl: true, linkedinUrl: true, foundedYear: true, tags: true } });
    if (co) {
      const c = parsed.company;
      const fill: Prisma.CompanyUpdateInput = {};
      if (!co.servicesOrApps && c.servicesOrApps) fill.servicesOrApps = c.servicesOrApps;
      if (!co.careerPageUrl && c.careerPageUrl) fill.careerPageUrl = c.careerPageUrl;
      if (!co.linkedinUrl && c.linkedinUrl) fill.linkedinUrl = c.linkedinUrl;
      if (!co.foundedYear && c.foundedYear) fill.foundedYear = c.foundedYear;
      const tags = c.tags.filter((x) => !co.tags.includes(x));
      if (tags.length) {
        fill.tags = [...co.tags, ...tags];
        await addOptions("COMPANY", "tags", tags);
      }
      if (Object.keys(fill).length) await db.company.update({ where: { id: companyId }, data: fill });
    }
    const main = phones.find((p) => !p.contactId && !p.extension);
    if (parsed.directory && main && !main.ivrPath) {
      await db.phoneNumber.update({ where: { id: main.id }, data: { ivrPath: parsed.directory.slice(0, 300) } });
      main.ivrPath = parsed.directory;
    }
  }

  // Caller Notes → calls (skipping ones already imported: same time and number on this record).
  // Written in bulk: a lead can carry dozens of calls, and each request has to finish within a serverless time limit.
  const tz =
    run.options.dynamicsTimeZone === "company" && companyId ? ((await db.company.findUnique({ where: { id: companyId }, select: { timeZone: true } }))?.timeZone ?? "Asia/Dhaka") : "Asia/Dhaka";
  const callContacts = new Set<string>();
  const results: (string | null)[] = [];
  const existing = await db.activity.findMany({ where: { type: { in: ["CALL", "NOTE"] }, deletedAt: null, ...scope }, select: { type: true, occurredAt: true, dialedNumber: true, body: true } });
  const seenCalls = new Set(existing.filter((a) => a.type === "CALL").map((a) => `${a.occurredAt.toISOString()}|${a.dialedNumber ?? ""}`));
  const seenNotes = new Set(existing.filter((a) => a.type === "NOTE").map((a) => a.body ?? ""));
  type NewActivity = { data: Prisma.ActivityCreateManyInput; contactId: string | null };
  const batch: NewActivity[] = [];
  const lastDial = new Map<string, { at: Date; status: string | null }>();
  for (const call of keep(parsed.calls)) {
    const occurredAt = new Date(fromLocalInput(call.at, tz));
    const seenKey = `${occurredAt.toISOString()}|${call.number ?? ""}`;
    if (seenCalls.has(seenKey)) continue;
    seenCalls.add(seenKey);
    const target = mentioned(call.outcomeText) ?? leadId;
    const phone = call.number ? phones.find((p) => p.number === call.number && !p.extension) ?? phones.find((p) => p.number === call.number) : undefined;
    batch.push({
      data: {
        type: "CALL",
        ownerId: null,
        occurredAt,
        dialedNumber: call.number,
        phoneNumberId: phone?.id ?? null,
        callPath: call.path,
        callResult: call.result,
        targetContactId: target,
        body: call.raw,
        properties: json({ importedFrom: "Dynamics CRM Caller Notes" }),
      },
      contactId: target,
    });
    if (phone && call.result && (!lastDial.has(phone.id) || lastDial.get(phone.id)!.at < occurredAt)) {
      const status = call.result === "Wrong Number" ? "Wrong" : call.result === "Temp Busy" ? "Temp Busy" : call.result !== "No Answer" ? "Valid" : null;
      lastDial.set(phone.id, { at: occurredAt, status });
    }
    if (target) callContacts.add(target);
    results.push(call.result);
    counts.calls++;
  }

  // Other dated entries → notes; text nothing understood → one note so no information is lost
  // Notes are skipped when the same text is already on the record (re-imports)
  const note = (body: string, at: Date, ownerId: string | null) => {
    if (seenNotes.has(body)) return;
    seenNotes.add(body);
    batch.push({ data: { type: "NOTE", ownerId, occurredAt: at, body }, contactId: null });
    counts.notes++;
  };
  for (const n of keep(parsed.notes)) note(n.body, n.at ? new Date(fromLocalInput(n.at, tz)) : new Date(), null);
  if (parsed.unparsed.length && !run.exclude.has("u")) note(`From Dynamics CRM (kept as written):\n${parsed.unparsed.join("\n")}`, new Date(), run.userId);

  if (batch.length) {
    const created = await db.activity.createManyAndReturn({ data: batch.map((b) => b.data), select: { id: true } });
    const contactLinks = created.flatMap((a, i) => {
      const contactId = batch[i].contactId ?? leadId;
      return contactId ? [{ activityId: a.id, contactId }] : [];
    });
    if (contactLinks.length) await db.activityContact.createMany({ data: contactLinks, skipDuplicates: true });
    if (companyId) await db.activityCompany.createMany({ data: created.map((a) => ({ activityId: a.id, companyId })), skipDuplicates: true });
  }
  for (const [id, d] of lastDial) await db.phoneNumber.update({ where: { id }, data: { lastDialedAt: d.at, ...(d.status ? { status: d.status } : {}) } });

  // Call history moves the totals and the company's journey
  if (counts.calls) {
    await recomputeCallRollups(companyId, [...callContacts]);
    if (companyId) {
      const best = results.includes("Meeting Booked") ? "Meeting Booked" : (results.find((r) => /^connected|callback/i.test(r ?? "")) ?? results.find(Boolean) ?? null);
      await advanceJourney(companyId, stageForCall(best), run.userId, { source: "import", reason: run.source });
    }
  }
  const parts = [
    counts.contacts && `${counts.contacts} target${counts.contacts === 1 ? "" : "s"}`,
    counts.numbers && `${counts.numbers} number${counts.numbers === 1 ? "" : "s"}`,
    counts.calls && `${counts.calls} call${counts.calls === 1 ? "" : "s"}`,
    counts.notes && `${counts.notes} note${counts.notes === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? `Dynamics: ${parts.join(", ")}` : "";
}

interface JobMapping {
  headers: string[];
  columns: ImportTarget[];
  options: ImportOptions;
  segmentId: string | null;
}

/** Validate (dry run) or import one chunk of rows. Without a jobId it's always a dry run. */
async function runRows(object: ImportObject, job: JobMapping, rows: ImportRow[], userId: string, source: string, dryRun: boolean): Promise<ImportChunkResult> {
  if (rows.length > MAX_CHUNK) throw new Error("Too many rows in one request");
  const other: ImportObject = object === "CONTACT" ? "COMPANY" : "CONTACT";
  const [defs, otherDefs, users, outcomeList] = await Promise.all([
    getPropDefs(object),
    getPropDefs(other),
    db.user.findMany({ select: { id: true, name: true, email: true } }),
    db.optionList.findUnique({ where: { key: "callResult" } }),
  ]);
  const ctx: ParseContext = { users, addMissingOptions: job.options.addMissingOptions, added: new Map(), companyAdded: new Map(), warnings: [] };
  const outcomes = ((outcomeList?.options as PropOption[] | null) ?? []).map((o) => o.value);
  const run: RunContext = { object, defs, options: job.options, userId, source, segmentId: job.segmentId, dryRun, outcomes, exclude: new Set() };
  const results: ImportRowResult[] = [];

  // New dropdown values are saved before the rows that use them
  const prepared = rows.map((r) => {
    try {
      return { row: r.row, exclude: r.exclude, p: prepare(job.columns, job.headers, r.cells, defs, otherDefs, ctx) };
    } catch (e) {
      return { row: r.row, error: e instanceof Error ? e.message : "Invalid row" };
    }
  });
  const addedOptions: ImportChunkResult["addedOptions"] = [];
  for (const [target, added] of [
    [object, ctx.added],
    [other, ctx.companyAdded],
  ] as const) {
    for (const [name, opts] of added) {
      for (const o of opts) addedOptions.push({ property: target === object ? name : `${other === "COMPANY" ? "Company" : "Lead person"} › ${name}`, value: o.value });
      if (dryRun) continue;
      await addOptions(target, name, opts);
    }
  }

  for (const item of prepared) {
    if ("error" in item) {
      results.push({ row: item.row, action: "error", message: item.error });
      continue;
    }
    try {
      run.exclude = new Set(item.exclude ?? []);
      results.push({ row: item.row, ...(await importRow(item.p!, run, item.row)) });
    } catch (e) {
      results.push({ row: item.row, action: "error", message: e instanceof Error ? e.message : "Couldn't import this row" });
    }
  }
  return { results, addedOptions };
}

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
