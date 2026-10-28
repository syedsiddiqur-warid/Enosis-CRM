// Lead-generation & research connectors. Server-only.
// API keys are read from environment variables only (never stored in the database or sent to the client).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPropDefs } from "./properties";
import { createSignal, type SignalInput } from "./signals";
import type { PropOption } from "./types";

export interface ProviderInfo {
  id: string;
  name: string;
  /** api: enrich companies through the provider's API; file: bring lists in through Research intake / import */
  kind: "api" | "file";
  envKey?: string;
  description: string;
  capabilities: string[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "apollo",
    name: "Apollo.io",
    kind: "api",
    envKey: "APOLLO_API_KEY",
    description: "Organization enrichment by domain: industry, headcount, location, founded year, revenue, tech stack and funding.",
    capabilities: ["Enrich company", "Funding-round signals"],
  },
  {
    id: "lusha",
    name: "Lusha",
    kind: "api",
    envKey: "LUSHA_API_KEY",
    description: "Company enrichment by domain: description, industry, headcount, location and LinkedIn page.",
    capabilities: ["Enrich company"],
  },
  {
    id: "seamless",
    name: "Seamless.AI",
    kind: "file",
    description: "Export company lists from Seamless.AI and paste them into Research intake (their API needs an enterprise agreement).",
    capabilities: ["List intake"],
  },
  {
    id: "salesnav",
    name: "LinkedIn Sales Navigator",
    kind: "file",
    description: "Sales Navigator has no public API (partner program only). Export account lists and paste them into Research intake.",
    capabilities: ["List intake"],
  },
  {
    id: "zoominfo",
    name: "ZoomInfo",
    kind: "file",
    description: "Export company lists and paste them into Research intake.",
    capabilities: ["List intake"],
  },
  {
    id: "directories",
    name: "Online directories & web portals",
    kind: "file",
    description: "Clutch, Capterra, G2 and other directories or portals: paste names and domains into Research intake.",
    capabilities: ["List intake"],
  },
];

export interface IntegrationSettings {
  autoEnrichOnCreate: boolean;
  /** Replace values that are already filled in (default: only fill empty fields) */
  overwrite: boolean;
  createSignals: boolean;
}

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = { autoEnrichOnCreate: false, overwrite: false, createSignals: true };

export function provider(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}

export function isConfigured(p: ProviderInfo) {
  return !!(p.envKey && process.env[p.envKey]);
}

export async function integrationState(id: string) {
  const row = await db.integration.findUnique({ where: { provider: id } });
  return { enabled: row?.enabled ?? false, settings: { ...DEFAULT_INTEGRATION_SETTINGS, ...((row?.settings ?? {}) as Partial<IntegrationSettings>) }, row };
}

// ── Provider adapters ──

interface Enriched {
  fields: Record<string, unknown>;
  signals: SignalInput[];
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);

/** Apollo.io organization enrichment (GET /api/v1/organizations/enrich). */
export function mapApollo(body: Json): Enriched | null {
  const o = body.organization as Json | undefined;
  if (!o) return null;
  const phone = (o.primary_phone as Json | undefined)?.sanitized_number ?? o.phone;
  const fundingStage = str(o.latest_funding_stage);
  const totalFunding = str(o.total_funding_printed);
  const fields: Record<string, unknown> = {
    name: str(o.name),
    linkedinUrl: str(o.linkedin_url),
    phone: str(phone),
    industry: str(o.industry),
    employees: num(o.estimated_num_employees),
    foundedYear: num(o.founded_year),
    annualRevenue: num(o.annual_revenue),
    city: str(o.city),
    state: str(o.state),
    country: str(o.country),
    description: str(o.short_description),
    technologies: Array.isArray(o.technology_names) ? (o.technology_names as unknown[]).map(String) : null,
    investmentInfo: fundingStage || totalFunding ? [fundingStage, totalFunding && `total ${totalFunding}`].filter(Boolean).join(", ") : null,
  };
  const signals: SignalInput[] = [];
  const roundDate = str(o.latest_funding_round_date);
  if (roundDate) {
    const at = new Date(roundDate);
    const ageDays = (Date.now() - at.getTime()) / 864e5;
    if (!Number.isNaN(at.getTime()) && ageDays <= 365) {
      signals.push({
        type: "Funding round",
        title: `${fundingStage ?? "Funding"} round${totalFunding ? ` (total funding ${totalFunding})` : ""}`,
        source: "Apollo.io",
        strength: ageDays <= 180 ? "High" : "Medium",
        detectedAt: at.toISOString(),
      });
    }
  }
  return { fields, signals };
}

/** Lusha company enrichment (GET /v2/company). Field names vary between plans, so every read is defensive. */
export function mapLusha(body: Json): Enriched | null {
  const d = (body.data ?? body) as Json | undefined;
  if (!d || !str(d.name)) return null;
  const loc = (d.location ?? {}) as Json;
  const social = (d.social ?? {}) as Json;
  const employees = d.employees;
  const range = typeof employees === "string" ? employees.match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ""))) : null;
  return {
    fields: {
      name: str(d.name),
      description: str(d.description),
      industry: str((d.industryPrimaryGroupDetails as Json | undefined)?.name) ?? str(d.mainIndustry) ?? str(d.industry),
      employees: num(employees) ?? (range?.length ? Math.round(range.reduce((a, b) => a + b, 0) / range.length) : null),
      foundedYear: num(d.founded) ?? num(d.foundedYear),
      city: str(loc.city),
      state: str(loc.state),
      country: str(loc.country),
      linkedinUrl: str((social.linkedin as Json | undefined)?.url) ?? str(social.linkedin),
    },
    signals: [],
  };
}

async function callProvider(id: string, domain: string): Promise<Enriched | null> {
  const p = provider(id);
  if (!p || p.kind !== "api") throw new Error("This source has no API connector");
  const key = p.envKey ? process.env[p.envKey] : undefined;
  if (!key) throw new Error(`${p.name} isn't connected. Set ${p.envKey} on the server.`);
  const request =
    id === "apollo"
      ? fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
          headers: { "x-api-key": key, accept: "application/json", "Cache-Control": "no-cache" },
          cache: "no-store",
        })
      : fetch(`https://api.lusha.com/v2/company?domain=${encodeURIComponent(domain)}`, { headers: { api_key: key, accept: "application/json" }, cache: "no-store" });
  const res = await request;
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error(`${p.name} rejected the API key (${res.status})`);
  if (res.status === 429) throw new Error(`${p.name} rate limit reached; try again later`);
  if (!res.ok) throw new Error(`${p.name} returned ${res.status}`);
  const body = (await res.json()) as Json;
  return id === "apollo" ? mapApollo(body) : mapLusha(body);
}

/** Match a provider value to one of the property's options (case-insensitive), or drop it. */
function matchOption(value: string, options: PropOption[] | undefined) {
  return options?.find((o) => o.value.toLowerCase() === value.toLowerCase() || o.label.toLowerCase() === value.toLowerCase())?.value ?? null;
}

/** Enrich one company from a provider: fill empty fields (or overwrite, per settings), add signals, log the run. */
export async function enrichCompany(id: string, providerId: string, userId: string | null) {
  const p = provider(providerId);
  if (!p) throw new Error("Unknown provider");
  const { settings } = await integrationState(providerId);
  const company = await db.company.findUniqueOrThrow({ where: { id } });
  if (!company.domain) throw new Error("Add the company domain first");

  let result: Enriched | null;
  try {
    result = await callProvider(providerId, company.domain);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Enrichment failed";
    await db.enrichmentRun.create({ data: { provider: providerId, companyId: id, status: "failed", error, userId } });
    await db.integration.upsert({ where: { provider: providerId }, create: { provider: providerId, lastRunAt: new Date(), lastError: error }, update: { lastRunAt: new Date(), lastError: error } });
    throw e;
  }
  if (!result) {
    await db.enrichmentRun.create({ data: { provider: providerId, companyId: id, status: "no_match", userId } });
    await db.integration.upsert({ where: { provider: providerId }, create: { provider: providerId, lastRunAt: new Date() }, update: { lastRunAt: new Date(), lastError: null } });
    return { status: "no_match" as const, changed: 0, signals: 0 };
  }

  const defs = await getPropDefs("COMPANY");
  const record = company as unknown as Record<string, unknown>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const data: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(result.fields)) {
    if (raw === null || raw === undefined || (Array.isArray(raw) && !raw.length)) continue;
    const def = defs.find((d) => d.name === name && d.isBuiltIn);
    if (!def || name === "name") continue; // keep the researched company name
    let value: unknown = raw;
    if (def.type === "ENUM") value = matchOption(String(raw), def.options);
    if (def.type === "MULTI_ENUM") value = [...new Set((raw as string[]).map((v) => matchOption(v, def.options)).filter(Boolean))];
    if (name === "employees" || name === "foundedYear") value = Math.round(Number(raw)); // Int columns
    if (value === null || (Array.isArray(value) && !value.length)) continue;
    const before = record[name];
    const empty = before === null || before === undefined || before === "" || (Array.isArray(before) && !before.length);
    if (!empty && !settings.overwrite) continue;
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    data[name] = value;
    changes[name] = { from: before ?? null, to: value };
  }
  await db.company.update({ where: { id }, data: { ...(data as Prisma.CompanyUpdateInput), lastEnrichedAt: new Date() } });

  let signals = 0;
  if (settings.createSignals) for (const s of result.signals) if ((await createSignal(id, s, userId)).created) signals++;

  const changed = Object.keys(changes).length;
  await db.enrichmentRun.create({ data: { provider: providerId, companyId: id, status: changed || signals ? "updated" : "no_change", changes: changes as Prisma.InputJsonValue, userId } });
  await db.integration.upsert({ where: { provider: providerId }, create: { provider: providerId, lastRunAt: new Date() }, update: { lastRunAt: new Date(), lastError: null } });
  if (changed) {
    await db.auditLog.create({ data: { objectType: "COMPANY", recordId: id, action: "enrich", changes: { ...changes, provider: p.name } as Prisma.InputJsonValue, userId } });
    await db.activity.create({
      data: {
        type: "SYSTEM",
        ownerId: userId,
        systemData: { kind: "enriched", source: p.name, label: `${changed} field${changed === 1 ? "" : "s"}`, to: Object.keys(changes).map((k) => defs.find((d) => d.name === k)?.label ?? k).join(", ") },
        companies: { create: { companyId: id } },
      },
    });
  }
  return { status: changed || signals ? ("updated" as const) : ("no_change" as const), changed, signals };
}
