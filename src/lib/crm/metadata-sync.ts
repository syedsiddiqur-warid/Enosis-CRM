// Brings a database created by an older version up to date with the default metadata:
// properties added since (created with their group), the country / state-province / time zone pick lists,
// and stored locations ("USA" → United States, "TX" → Texas, time zone from them).
// Used by the seed and by `npm run db:sync`. Never removes or renames anything an admin made.
import type { Prisma, PrismaClient } from "@prisma/client";
import { PROPERTIES, PROPERTY_GROUPS, TIME_ZONES } from "./defaults";
import { findCountry, normalizeCountry, normalizeRegion, timeZoneFor } from "./geo";
import type { PropOption } from "./types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Create default properties (and their groups) that the database doesn't have yet. Returns the names added. */
export async function addMissingProperties(db: PrismaClient) {
  const added: string[] = [];
  for (const objectType of ["CONTACT", "COMPANY"] as const) {
    const have = new Set((await db.propertyDefinition.findMany({ where: { objectType }, select: { name: true } })).map((p) => p.name));
    const missing = PROPERTIES[objectType].filter((p) => !have.has(p.name));
    if (!missing.length) continue;
    const groups = await db.propertyGroup.findMany({ where: { objectType } });
    const groupId = async (name: string) => {
      const g = groups.find((x) => x.name === name);
      if (g) return g.id;
      const seed = PROPERTY_GROUPS[objectType].find((x) => x.name === name);
      const row = await db.propertyGroup.create({ data: { objectType, name, label: seed?.label ?? name, order: groups.length } });
      groups.push(row);
      return row.id;
    };
    const last = await db.propertyDefinition.aggregate({ where: { objectType }, _max: { order: true } });
    let order = (last._max.order ?? 0) + 1;
    for (const p of missing) {
      await db.propertyDefinition.create({
        data: {
          objectType,
          name: p.name,
          label: p.label,
          type: p.type,
          groupId: await groupId(p.group),
          order: order++,
          isBuiltIn: p.isBuiltIn ?? true,
          isReadOnly: p.isReadOnly ?? false,
          format: p.format,
          description: p.description,
          options: (p.options ?? undefined) as Prisma.InputJsonValue | undefined,
          showWhen: (p.showWhen ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      added.push(`${objectType === "CONTACT" ? "Contact" : "Company"} › ${p.label}`);
    }
  }
  return added;
}

/** Update the country, state/province and time zone properties to the current definitions. Keeps options admins added. */
export async function syncGeoProperties(db: PrismaClient) {
  for (const objectType of ["CONTACT", "COMPANY"] as const) {
    const wanted = PROPERTIES[objectType].filter((p) => ["country", "state", "timeZone"].includes(p.name));
    const rows = await db.propertyDefinition.findMany({ where: { objectType, name: { in: ["country", "state", "timeZone", "city"] } } });
    for (const p of wanted) {
      const row = rows.find((r) => r.name === p.name);
      const extra = ((row?.options as PropOption[] | null) ?? []).filter((o) => !p.options?.some((x) => x.value === o.value));
      const options = p.options ? [...p.options, ...extra.map((o, i) => ({ ...o, order: p.options!.length + i }))] : undefined;
      const data = { label: p.label, type: p.type, description: p.description ?? null, ...(options ? { options: json(options) } : {}) };
      if (row) await db.propertyDefinition.update({ where: { id: row.id }, data });
      else {
        // New property (a contact's State/Province): next to the country
        const anchor = rows.find((r) => r.name === "country") ?? rows.find((r) => r.name === "city");
        await db.propertyDefinition.create({ data: { objectType, name: p.name, isBuiltIn: true, groupId: anchor?.groupId ?? null, order: anchor?.order ?? 0, ...data } });
      }
    }
  }
  // Time zone options in saved option lists elsewhere stay valid: every old value is an IANA zone in TIME_ZONES
  return TIME_ZONES.length;
}

/** Normalize stored countries and states and set each record's time zone from them. */
export async function syncGeoRecords(db: PrismaClient) {
  const unknownCountries = new Set<string>();
  let changed = 0;
  for (const model of ["company", "contact"] as const) {
    const rows: { id: string; country: string | null; state: string | null; timeZone: string | null }[] =
      model === "company"
        ? await db.company.findMany({ where: { OR: [{ country: { not: null } }, { state: { not: null } }] }, select: { id: true, country: true, state: true, timeZone: true } })
        : await db.contact.findMany({ where: { OR: [{ country: { not: null } }, { state: { not: null } }] }, select: { id: true, country: true, state: true, timeZone: true } });
    for (const r of rows) {
      const country = r.country?.trim() ? normalizeCountry(r.country) : null;
      if (country && !findCountry(country)) unknownCountries.add(country);
      const state = r.state?.trim() ? normalizeRegion(country, r.state) : null;
      const timeZone = timeZoneFor(country, state) ?? r.timeZone;
      if (country === r.country && state === r.state && timeZone === r.timeZone) continue;
      const data = { country, state, timeZone };
      if (model === "company") await db.company.update({ where: { id: r.id }, data });
      else await db.contact.update({ where: { id: r.id }, data });
      changed++;
    }
  }
  return { changed, unknownCountries: [...unknownCountries] };
}
