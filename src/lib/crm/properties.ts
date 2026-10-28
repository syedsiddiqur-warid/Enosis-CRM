import { db } from "@/lib/db";
import { VIRTUAL_PROPERTIES } from "./defaults";
import type { CrmObject, PropDef, PropOption, RelatedDefs } from "./types";

/** Load active property definitions for an object, ordered by group then property. */
export async function getPropDefs(objectType: CrmObject): Promise<PropDef[]> {
  const rows = await db.propertyDefinition.findMany({
    where: { objectType, archivedAt: null },
    include: { group: true },
    orderBy: [{ group: { order: "asc" } }, { order: "asc" }],
  });
  return rows.map((r) => ({
    name: r.name,
    label: r.label,
    type: r.type,
    groupName: r.group?.name ?? null,
    groupLabel: r.group?.label ?? null,
    isBuiltIn: r.isBuiltIn,
    isReadOnly: r.isReadOnly,
    isVirtual: VIRTUAL_PROPERTIES[objectType].includes(r.name),
    format: r.format,
    description: r.description,
    showWhen: (r.showWhen as PropDef["showWhen"]) ?? null,
    options: ((r.options as PropOption[] | null) ?? undefined)?.filter((o) => !o.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
}

export async function getPropertyGroups(objectType: CrmObject) {
  return db.propertyGroup.findMany({ where: { objectType }, orderBy: { order: "asc" }, select: { name: true, label: true } });
}

/** Built-ins sort in Prisma; custom (jsonb) properties sort via raw SQL in fetchRows. */
export function isSortable(def: Pick<PropDef, "isVirtual" | "type">) {
  return !def.isVirtual && def.type !== "MULTI_ENUM" && def.type !== "FILE";
}

/** Fields of related rows that advanced filters can use: logged calls ("a call in the last 7 days with
 *  result VM"), buying signals ("a High funding signal this quarter") and campaign memberships
 *  ("Not interested in a previous campaign"). */
export async function getRelatedFilterDefs(): Promise<RelatedDefs> {
  const [lists, campaigns] = await Promise.all([
    db.optionList.findMany({ where: { key: { in: ["callResult", "callPath", "signalType", "signalStrength", "signalSource", "campaignMemberStatus"] } } }),
    db.campaign.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const options = (key: string) => ((lists.find((l) => l.key === key)?.options as PropOption[] | null) ?? []).filter((o) => !o.archived);
  const base = (groupName: string, groupLabel: string) => ({ groupName, groupLabel, isBuiltIn: true, isReadOnly: true });
  const call = base("calls", "Calls");
  const signal = base("signals", "Buying signals");
  const camp = base("campaigns", "Campaigns");
  return {
    CALL: [
      { ...call, name: "callResult", label: "Call result", type: "ENUM", options: options("callResult") },
      { ...call, name: "callPath", label: "Call path", type: "ENUM", options: options("callPath") },
      { ...call, name: "occurredAt", label: "Call date", type: "DATETIME" },
      { ...call, name: "ownerId", label: "Called by", type: "USER" },
      { ...call, name: "durationSec", label: "Duration (seconds)", type: "NUMBER" },
      { ...call, name: "campaignId", label: "Logged for campaign", type: "ENUM", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
    ],
    SIGNAL: [
      { ...signal, name: "type", label: "Signal type", type: "ENUM", options: options("signalType") },
      { ...signal, name: "strength", label: "Signal strength", type: "ENUM", options: options("signalStrength") },
      { ...signal, name: "source", label: "Signal source", type: "ENUM", options: options("signalSource") },
      { ...signal, name: "detectedAt", label: "Signal date", type: "DATETIME" },
    ],
    CAMPAIGN: [
      { ...camp, name: "campaignId", label: "Campaign", type: "ENUM", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
      { ...camp, name: "status", label: "Campaign outcome", type: "ENUM", options: options("campaignMemberStatus") },
      { ...camp, name: "attempts", label: "Calls in campaign", type: "NUMBER" },
      { ...camp, name: "lastResult", label: "Last call result in campaign", type: "ENUM", options: options("callResult") },
      { ...camp, name: "addedAt", label: "Added to campaign", type: "DATETIME" },
    ],
  };
}

/** Coerce a raw UI value into what the column / jsonb expects. */
export function coerceValue(def: PropDef, value: unknown): unknown {
  if (value === "" || value === undefined) return null;
  if (value === null) return null;
  switch (def.type) {
    case "NUMBER": {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`${def.label} must be a number`);
      return n;
    }
    case "BOOLEAN":
      return value === true || value === "true";
    case "DATE":
    case "DATETIME": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new Error(`${def.label} must be a date`);
      return def.isBuiltIn ? d : d.toISOString();
    }
    case "MULTI_ENUM":
      return Array.isArray(value) ? value.map(String) : [String(value)];
    case "ENUM":
    case "RADIO": {
      const v = String(value);
      if (def.options && !def.options.some((o) => o.value === v)) throw new Error(`"${v}" is not an option for ${def.label}`);
      return v;
    }
    case "EMAIL": {
      const v = String(value).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error("Enter a valid email address");
      return v;
    }
    default:
      return String(value).trim();
  }
}
