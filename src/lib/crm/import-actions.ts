"use server";

// CSV / Excel import of contacts and companies: column mapping, validation (dry run), de-duplication,
// company linking, saved mapping templates and import history. Rows arrive from the browser in chunks.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { fromLocalInput } from "./dates";
import { parseDynamics, type DynamicsParsed } from "./dynamics-parser";
import {
  COMPANY_PROP_PREFIX,
  DYN_CALLER_NOTES,
  DYN_DESCRIPTION,
  NOT_IMPORTABLE,
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
  /** Same, for company properties filled from a contact import */
  companyAdded: Map<string, PropOption[]>;
}

function matchOption(def: PropDef, raw: string, ctx: ParseContext): string {
  const v = raw.trim();
  const opts = [...(def.options ?? []), ...(ctx.added.get(def.name) ?? [])];
  const hit = opts.find((o) => o.value.toLowerCase() === v.toLowerCase() || o.label.toLowerCase() === v.toLowerCase());
  if (hit) return hit.value;
  if (!ctx.addMissingOptions) throw new Error(`"${v}" isn't an option (allowed: ${opts.map((o) => o.label).join(", ")})`);
  const list = ctx.added.get(def.name) ?? [];
  list.push({ value: v, label: v, order: opts.length });
  ctx.added.set(def.name, list);
  return v;
}

/** Turn a cell into the value a property stores. Throws a readable error for bad values. */
function parseValue(def: PropDef, raw: string, ctx: ParseContext): unknown {
  const v = raw.trim();
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
            .split(/[;|]/)
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => matchOption(def, x, ctx)),
        ),
      ];
    case "USER": {
      const u = ctx.users.find((x) => x.email.toLowerCase() === v.toLowerCase() || x.name?.toLowerCase() === v.toLowerCase());
      if (!u) throw new Error(`No user "${v}" (use their email)`);
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
  phones: string[];
  note: string | null;
  dynDescription: string | null;
  dynCallerNotes: string | null;
}

function prepare(columns: ImportTarget[], headers: string[], cells: (string | null)[], defs: PropDef[], companyDefs: PropDef[], ctx: ParseContext): Prepared {
  const out: Prepared = {
    builtIn: {},
    custom: {},
    companyName: null,
    companyDomain: null,
    companyBuiltIn: {},
    companyCustom: {},
    phones: [],
    note: null,
    dynDescription: null,
    dynCallerNotes: null,
  };
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
      else if (target.startsWith(COMPANY_PROP_PREFIX)) {
        const def = companyDefs.find((d) => d.name === target.slice(COMPANY_PROP_PREFIX.length));
        if (!def || def.isVirtual || NOT_IMPORTABLE.has(def.name)) return;
        // Company dropdown values are matched against the company property's options
        const value = parseValue(def, cell, { ...ctx, added: ctx.companyAdded });
        if (value === null || value === undefined) return;
        (def.isBuiltIn ? out.companyBuiltIn : out.companyCustom)[def.name] = value;
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
  return out;
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

async function importRow(p: Prepared, run: RunContext): Promise<{ action: ImportRowResult["action"]; id?: string; message?: string }> {
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
    if (domain) {
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
  if (run.dryRun) return { action: existing ? "updated" : "created", id: existing?.id };

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
  if (p.note) {
    await db.activity.create({
      data: {
        type: "NOTE",
        ownerId: run.userId,
        body: p.note,
        ...(object === "CONTACT" ? { contacts: { create: { contactId: id } } } : { companies: { create: { companyId: id } } }),
      },
    });
  }
  let dynMessage: string | undefined;
  if (p.dynDescription || p.dynCallerNotes) {
    const parsed = parseDynamics(p.dynDescription, p.dynCallerNotes, run.outcomes);
    dynMessage = await applyDynamics(parsed, { recordId: id, companyId: object === "COMPANY" ? id : companyId && companyId !== "new" ? companyId : null }, run);
  }
  if (run.segmentId) {
    await db.segmentMember.upsert({
      where: { segmentId_recordId: { segmentId: run.segmentId, recordId: id } },
      create: { segmentId: run.segmentId, recordId: id, addedById: run.userId, ...(object === "CONTACT" ? { contactId: id } : { companyId: id }) },
      update: {},
    });
  }
  return { action: existing ? "updated" : "created", id, message: dynMessage };
}

// ── Dynamics free text: Targets>>, Numbers>>, Caller Notes ──

const nameKey = (first: string | null, last: string | null) => `${first ?? ""} ${last ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");

/** Write the parsed Description / Caller Notes of one row. `recordId` is the imported contact or company. */
async function applyDynamics(parsed: DynamicsParsed, ref: { recordId: string; companyId: string | null }, run: RunContext): Promise<string> {
  const keep = <T extends { key: string }>(items: T[]) => items.filter((i) => !run.exclude.has(i.key));
  const leadId = run.object === "CONTACT" ? ref.recordId : null;
  const { companyId } = ref;
  const counts = { contacts: 0, numbers: 0, calls: 0, notes: 0 };

  // People already at the company (and the lead person), to match names mentioned in the text
  const known = companyId
    ? await db.contact.findMany({ where: { deletedAt: null, companies: { some: { companyId } } }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, linkedinUrl: true } })
    : leadId
      ? await db.contact.findMany({ where: { id: leadId }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, linkedinUrl: true } })
      : [];

  // Targets>> → contacts (matched by email, then by name at the company; existing ones only get empty fields filled)
  for (const t of keep(parsed.targets)) {
    let match = (t.email && known.find((k) => k.email?.toLowerCase() === t.email)) || known.find((k) => nameKey(k.firstName, k.lastName) === nameKey(t.firstName, t.lastName));
    if (!match && t.email) match = (await db.contact.findFirst({ where: { email: t.email, deletedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, linkedinUrl: true } })) ?? undefined;
    if (match) {
      const fill: Prisma.ContactUpdateInput = {};
      if (!match.jobTitle && t.jobTitle) fill.jobTitle = t.jobTitle;
      if (!match.email && t.email) fill.email = t.email;
      if (!match.phone && t.phone) fill.phone = t.phone;
      if (!match.linkedinUrl && t.linkedinUrl) fill.linkedinUrl = t.linkedinUrl;
      if (Object.keys(fill).length) await db.contact.update({ where: { id: match.id }, data: fill });
    } else {
      const c = await db.contact.create({
        data: {
          firstName: t.firstName,
          lastName: t.lastName,
          jobTitle: t.jobTitle,
          email: t.email,
          phone: t.phone,
          linkedinUrl: t.linkedinUrl,
          ownerId: run.options.ownerId,
          lifecycleStage: "Lead",
          leadStatus: "New",
          callStatus: "Never Reached Targets",
          createdById: run.userId,
          activities: { create: { activity: { create: { type: "SYSTEM", ownerId: run.userId, systemData: { kind: "imported", source: `${run.source} (Targets>>)` } } } } },
        },
        select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, linkedinUrl: true },
      });
      match = c;
      known.push(c);
      counts.contacts++;
    }
    if (companyId && !(await db.contactCompany.findUnique({ where: { contactId_companyId: { contactId: match.id, companyId } } }))) {
      const hasPrimary = await db.contactCompany.count({ where: { contactId: match.id, isPrimary: true } });
      await db.contactCompany.create({ data: { contactId: match.id, companyId, isPrimary: !hasPrimary } });
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
  const phones = await db.phoneNumber.findMany({
    where: companyId ? { OR: [{ companyId }, { contact: { companies: { some: { companyId } } } }] } : { contactId: leadId ?? "" },
    select: { id: true, number: true },
  });
  for (const n of keep(parsed.numbers)) {
    if (phones.some((p) => p.number === n.number)) continue;
    const contactId = mentioned(n.contactHint);
    const row = await db.phoneNumber.create({
      data: { number: n.number, extension: n.extension, type: n.type, ivrPath: n.ivrPath, status: n.status ?? "Unknown", companyId, contactId: contactId ?? (companyId ? null : leadId) },
      select: { id: true, number: true },
    });
    phones.push(row);
    counts.numbers++;
  }

  // Caller Notes → calls (skipping ones already imported: same time and number on this record)
  const tz =
    run.options.dynamicsTimeZone === "company" && companyId ? ((await db.company.findUnique({ where: { id: companyId }, select: { timeZone: true } }))?.timeZone ?? "Asia/Dhaka") : "Asia/Dhaka";
  const callContacts = new Set<string>();
  const results: (string | null)[] = [];
  const link = (contactId: string | null) => ({
    ...(contactId ? { contacts: { create: { contactId } } } : leadId ? { contacts: { create: { contactId: leadId } } } : {}),
    ...(companyId ? { companies: { create: { companyId } } } : {}),
  });
  for (const call of keep(parsed.calls)) {
    const occurredAt = new Date(fromLocalInput(call.at, tz));
    const dupe = await db.activity.count({
      where: {
        type: "CALL",
        deletedAt: null,
        occurredAt,
        dialedNumber: call.number,
        ...(companyId ? { companies: { some: { companyId } } } : { contacts: { some: { contactId: leadId ?? "" } } }),
      },
    });
    if (dupe) continue;
    const target = mentioned(call.outcomeText) ?? leadId;
    const phone = call.number ? phones.find((p) => p.number === call.number) : undefined;
    await db.activity.create({
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
        ...link(target),
      },
    });
    if (phone && call.result) {
      const status = call.result === "Wrong Number" ? "Wrong" : call.result === "Temp Busy" ? "Temp Busy" : call.result !== "No Answer" ? "Valid" : null;
      await db.phoneNumber.update({ where: { id: phone.id }, data: { lastDialedAt: occurredAt, ...(status ? { status } : {}) } });
    }
    if (target) callContacts.add(target);
    results.push(call.result);
    counts.calls++;
  }

  // Other dated entries → notes; text nothing understood → one note so no information is lost
  // Notes are skipped when the same text is already on the record (re-imports)
  const scope = companyId ? { companies: { some: { companyId } } } : { contacts: { some: { contactId: leadId ?? "" } } };
  const hasNote = async (body: string) => (await db.activity.count({ where: { type: "NOTE", deletedAt: null, body, ...scope } })) > 0;
  for (const n of keep(parsed.notes)) {
    if (await hasNote(n.body)) continue;
    await db.activity.create({ data: { type: "NOTE", ownerId: null, occurredAt: n.at ? new Date(fromLocalInput(n.at, tz)) : new Date(), body: n.body, ...link(null) } });
    counts.notes++;
  }
  const leftover = `From Dynamics CRM (kept as written):\n${parsed.unparsed.join("\n")}`;
  if (parsed.unparsed.length && !run.exclude.has("u") && !(await hasNote(leftover))) {
    await db.activity.create({ data: { type: "NOTE", ownerId: run.userId, body: leftover, ...link(null) } });
    counts.notes++;
  }

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
  const [defs, companyDefs, users, outcomeList] = await Promise.all([
    getPropDefs(object),
    object === "CONTACT" ? getPropDefs("COMPANY") : Promise.resolve([] as PropDef[]),
    db.user.findMany({ select: { id: true, name: true, email: true } }),
    db.optionList.findUnique({ where: { key: "callResult" } }),
  ]);
  const ctx: ParseContext = { users, addMissingOptions: job.options.addMissingOptions, added: new Map(), companyAdded: new Map() };
  const outcomes = ((outcomeList?.options as PropOption[] | null) ?? []).map((o) => o.value);
  const run: RunContext = { object, defs, options: job.options, userId, source, segmentId: job.segmentId, dryRun, outcomes, exclude: new Set() };
  const results: ImportRowResult[] = [];

  // New dropdown values are saved before the rows that use them
  const prepared = rows.map((r) => {
    try {
      return { row: r.row, exclude: r.exclude, p: prepare(job.columns, job.headers, r.cells, defs, companyDefs, ctx) };
    } catch (e) {
      return { row: r.row, error: e instanceof Error ? e.message : "Invalid row" };
    }
  });
  const addedOptions: ImportChunkResult["addedOptions"] = [];
  for (const [target, added] of [
    [object, ctx.added],
    ["COMPANY", ctx.companyAdded],
  ] as const) {
    for (const [name, opts] of added) {
      for (const o of opts) addedOptions.push({ property: target === object ? name : `Company › ${name}`, value: o.value });
      if (dryRun) continue;
      const row = await db.propertyDefinition.findUnique({ where: { objectType_name: { objectType: target, name } } });
      const current = (row?.options as PropOption[] | null) ?? [];
      const fresh = opts.filter((o) => !current.some((c) => c.value.toLowerCase() === o.value.toLowerCase())).map((o, i) => ({ ...o, order: current.length + i }));
      if (fresh.length) await db.propertyDefinition.update({ where: { objectType_name: { objectType: target, name } }, data: { options: json([...current, ...fresh]) } });
    }
  }

  for (const item of prepared) {
    if ("error" in item) {
      results.push({ row: item.row, action: "error", message: item.error });
      continue;
    }
    try {
      run.exclude = new Set(item.exclude ?? []);
      results.push({ row: item.row, ...(await importRow(item.p!, run)) });
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
