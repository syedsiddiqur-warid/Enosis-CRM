// Server-only record writes shared by server actions and automations.
// Not a "use server" module: these take a trusted userId and must never be callable from the client.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rescoreCompanies } from "./follow-score";
import { findRegion, normalizeCountry, normalizeRegion, timeZoneFor } from "./geo";
import { JOURNEY_PROPERTY, shouldMove, stageForProperty, type JourneyMeta } from "./journey";
import { coerceValue, getPropDefs } from "./properties";
import { assertReadyToCall } from "./ready-check";
import type { CrmObject } from "./types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function readRecord(object: CrmObject, id: string) {
  if (object === "CONTACT") return db.contact.findUniqueOrThrow({ where: { id } });
  if (object === "COMPANY") return db.company.findUniqueOrThrow({ where: { id } });
  throw new Error("Unsupported object");
}

/** Set one property, then write an audit row and a timeline system event. `rule` marks automation changes;
 *  `journey` says why a company's lead journey stage changed. */
export async function applyUpdate(
  object: CrmObject,
  id: string,
  property: string,
  rawValue: unknown,
  userId: string,
  meta: { rule?: string; journey?: JourneyMeta } = {},
) {
  const defs = await getPropDefs(object);
  const def = defs.find((d) => d.name === property);
  if (!def) throw new Error(`Unknown property ${property}`);
  // Automations may set system-maintained properties; people may not
  if ((def.isReadOnly && !meta.rule) || def.isVirtual) throw new Error(`${def.label} is read-only`);

  const record = (await readRecord(object, id)) as unknown as Record<string, unknown> & { properties: Prisma.JsonObject };
  // "USA" → United States, "TX" → Texas
  if (typeof rawValue === "string" && rawValue.trim()) {
    const raw = rawValue;
    if (property === "country") rawValue = normalizeCountry(raw);
    if (property === "state") rawValue = normalizeRegion(record.country as string | null, raw);
  }
  const value = coerceValue(def, rawValue);
  const before = def.isBuiltIn ? record[property] : record.properties?.[property];
  if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) return false;
  // Research hands a company to sales only when it passes the ready-to-call checklist
  if (object === "COMPANY" && property === "callable" && value === "Yes" && !meta.rule) await assertReadyToCall(id);

  if (def.type === "USER" && value) {
    const exists = await db.user.count({ where: { id: String(value) } });
    if (!exists) throw new Error("Unknown user");
  }

  const data = def.isBuiltIn ? { [property]: value } : { properties: { ...(record.properties ?? {}), [property]: value } };
  if (object === "CONTACT") await db.contact.update({ where: { id }, data: data as Prisma.ContactUpdateInput });
  else await db.company.update({ where: { id }, data: data as Prisma.CompanyUpdateInput });

  const change = { property, label: def.label, from: before ?? null, to: value ?? null };
  await db.$transaction([
    db.auditLog.create({
      data: { objectType: object, recordId: id, action: "update", changes: json({ [property]: { from: change.from, to: change.to }, ...(meta.rule ? { rule: meta.rule } : {}) }), userId },
    }),
    db.activity.create({
      data: {
        type: "SYSTEM",
        ownerId: meta.rule ? null : userId,
        systemData: json({ kind: "property_change", ...change, ...(meta.rule ? { rule: meta.rule } : {}), ...(meta.journey?.reason ? { reason: meta.journey.reason } : {}) }),
        ...(object === "CONTACT" ? { contacts: { create: { contactId: id } } } : { companies: { create: { companyId: id } } }),
      },
    }),
  ]);
  if (object === "COMPANY") await afterCompanyChange(id, property, before, value, userId, meta);
  // The time zone follows the state/province, or the country when no state is known
  if (property === "country" || property === "state") {
    const location = { country: record.country, state: record.state, [property]: value } as { country?: string | null; state?: string | null };
    // A state/province of the old country doesn't belong to the new one
    if (property === "country" && findRegion(before as string | null, location.state) && !findRegion(location.country, location.state)) {
      await applyUpdate(object, id, "state", null, userId, { rule: "Time zone from location" });
      location.state = null;
    }
    const tz = timeZoneFor(location.country, location.state);
    if (tz && tz !== record.timeZone) await applyUpdate(object, id, "timeZone", tz, userId, { rule: "Time zone from location" });
  }
  return true;
}

/** Side effects of company changes: journey history, research/viability stamps, automatic journey moves. */
async function afterCompanyChange(id: string, property: string, before: unknown, value: unknown, userId: string, meta: { rule?: string; journey?: JourneyMeta }) {
  if (property === JOURNEY_PROPERTY) {
    await db.company.update({ where: { id }, data: { leadStateAt: new Date() } });
    // Disqualified / Nurture and similar stages change who is worth following up
    await rescoreCompanies([id]);
    if (value) {
      await db.journeyEvent.create({
        data: {
          companyId: id,
          fromStage: before ? String(before) : null,
          toStage: String(value),
          userId,
          source: meta.journey?.source ?? "manual",
          reason: meta.journey?.reason ?? null,
          campaignId: meta.journey?.campaignId ?? null,
          activityId: meta.journey?.activityId ?? null,
        },
      });
    }
    return;
  }

  const now = new Date();
  if (property === "viable" || property === "callable") {
    const company = await db.company.findUniqueOrThrow({ where: { id }, select: { properties: true } });
    const props = (company.properties ?? {}) as Prisma.JsonObject;
    await db.company.update({
      where: { id },
      data: {
        properties: { ...props, [`${property}CheckedBy`]: value ? userId : null, [`${property}CheckedOn`]: value ? now.toISOString() : null },
        // Callable starts (or ends) its wait in the Handover pool
        ...(property === "callable" ? { readyAt: value === "Yes" ? now : null } : {}),
      },
    });
  }
  if (property === "researchStatus" && value === "Done") {
    const company = await db.company.findUniqueOrThrow({ where: { id }, select: { researcherId: true } });
    await db.company.update({ where: { id }, data: { researchedAt: now, researcherId: company.researcherId ?? userId } });
  }

  const stage = stageForProperty(property, value);
  if (stage) await advanceJourney(id, stage, userId, { source: "research" });
}

/** Move a company along its lead journey if the move is forward (or a valid automatic exit). */
export async function advanceJourney(companyId: string, to: string, userId: string, journey: JourneyMeta) {
  const [company, defs] = await Promise.all([db.company.findUnique({ where: { id: companyId }, select: { leadState: true, deletedAt: true } }), getPropDefs("COMPANY")]);
  const options = defs.find((d) => d.name === JOURNEY_PROPERTY)?.options ?? [];
  if (!company || company.deletedAt || !options.some((o) => o.value === to)) return false;
  if (!shouldMove(company.leadState, to, options)) return false;
  return applyUpdate("COMPANY", companyId, JOURNEY_PROPERTY, to, userId, { rule: "Lead journey", journey });
}
