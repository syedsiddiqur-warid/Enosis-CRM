/* Smoke test for the filter engine: runs representative conditions against the seeded DB.
   Usage: npx tsx scripts/check-filters.ts */
import { db } from "../src/lib/db";
import { loadQueryContext } from "../src/lib/crm/context";
import { buildWhere, fetchRows } from "../src/lib/crm/query";
import { segmentRecordsWhere } from "../src/lib/crm/segments";
import { SEGMENT_PROPERTY, type CrmObject, type FilterCondition, type FilterGroup, type ViewState } from "../src/lib/crm/types";

async function main() {
  const admin = await db.user.findFirstOrThrow({ where: { role: { name: "Admin" } } });
  const ctx = await loadQueryContext(admin.id);
  const defs = ctx.defs;
  const base: ViewState = { quick: {}, chips: [], columns: [], sort: null, advanced: [] };

  const cases: [string, CrmObject, FilterCondition[] | FilterGroup[], string?][] = [
    ["custom enum researchResult = Viable", "CONTACT", [{ property: "researchResult", operator: "is_any_of", value: ["Viable"] }]],
    ["custom enum researchResult known", "CONTACT", [{ property: "researchResult", operator: "is_known" }]],
    ["custom enum researchResult unknown", "CONTACT", [{ property: "researchResult", operator: "is_unknown" }]],
    ["custom date researchedOn last 30 days", "CONTACT", [{ property: "researchedOn", operator: "relative", value: { preset: "last_x_days", days: 30 } }]],
    ["owner = me", "CONTACT", [{ property: "ownerId", operator: "is_any_of", value: ["__me__"] }]],
    ["owner unassigned", "CONTACT", [{ property: "ownerId", operator: "is_any_of", value: ["__none__"] }]],
    ["crtCount > 2", "CONTACT", [{ property: "crtCount", operator: "gt", value: 2 }]],
    ["createdAt this month", "CONTACT", [{ property: "createdAt", operator: "relative", value: { preset: "this_month" } }]],
    ["lastActivityAt more than 7 days ago", "CONTACT", [{ property: "lastActivityAt", operator: "more_than_days_ago", value: 7 }]],
    ["primary company contains 'tcp'", "CONTACT", [{ property: "primaryCompany", operator: "contains", value: "tcp" }]],
    ["assoc company.industry = Computer Software", "CONTACT", [{ property: "industry", operator: "is_any_of", value: ["Computer Software"], association: "COMPANY" }]],
    ["company technologies has .NET", "COMPANY", [{ property: "technologies", operator: "is_any_of", value: [".NET"] }]],
    ["company custom viable = Yes", "COMPANY", [{ property: "viable", operator: "is_any_of", value: ["Yes"] }]],
    ["company custom viable none of Yes", "COMPANY", [{ property: "viable", operator: "is_none_of", value: ["Yes"] }]],
    ["company name starts with 'b'", "COMPANY", [{ property: "name", operator: "starts_with", value: "b" }]],
    ["assoc contact.jobTitle contains CTO", "COMPANY", [{ property: "jobTitle", operator: "contains", value: "CTO", association: "CONTACT" }]],
  ];

  for (const [label, object, conds] of cases) {
    const state = { ...base, quick: Object.fromEntries((conds as FilterCondition[]).map((c, i) => [`${c.property}${i}`, c])) };
    const where = buildWhere(object, null, state, "", ctx);
    const { total } = await fetchRows(object, where, null, 0, 1, defs[object]);
    console.log(`${total.toString().padStart(4)}  ${label}`);
  }

  // Calls: conditions in one AND group must hold for the same call
  const callGroup = (conditions: FilterCondition[]): ViewState => ({ ...base, advanced: [{ op: "AND", conditions }] });
  for (const [label, st] of [
    ["has a call with result Gatekeeper", callGroup([{ property: "callResult", operator: "is_any_of", value: ["Gatekeeper"], association: "CALL" }])],
    ["has a call in the last 30 days", callGroup([{ property: "occurredAt", operator: "relative", value: { preset: "last_x_days", days: 30 }, association: "CALL" }])],
    [
      "call Gatekeeper AND within last 30 days (same call)",
      callGroup([
        { property: "callResult", operator: "is_any_of", value: ["Gatekeeper"], association: "CALL" },
        { property: "occurredAt", operator: "relative", value: { preset: "last_x_days", days: 30 }, association: "CALL" },
      ]),
    ],
  ] as const) {
    const { total } = await fetchRows("CONTACT", buildWhere("CONTACT", null, st, "", ctx), null, 0, 1, defs.CONTACT);
    console.log(`${total.toString().padStart(4)}  ${label}`);
  }

  // Buying signals and campaign memberships (same-row semantics, contacts reach them through companies)
  const notInterested = { property: "status", operator: "is_any_of", value: ["Not interested", "Nurture"], association: "CAMPAIGN" } as const;
  for (const [label, object, st] of [
    ["company has a Funding round signal", "COMPANY", callGroup([{ property: "type", operator: "is_any_of", value: ["Funding round"], association: "SIGNAL" }])],
    [
      "company has a High signal of type Hiring developers (same signal)",
      "COMPANY",
      callGroup([
        { property: "type", operator: "is_any_of", value: ["Hiring developers"], association: "SIGNAL" },
        { property: "strength", operator: "is_any_of", value: ["High"], association: "SIGNAL" },
      ]),
    ],
    ["contact whose company has any signal", "CONTACT", callGroup([{ property: "type", operator: "is_known", association: "SIGNAL" }])],
    ["company Not interested / Nurture in a campaign", "COMPANY", callGroup([notInterested])],
    ["contact at a company Not interested / Nurture in a campaign", "CONTACT", callGroup([notInterested])],
    ["company journey stage = Calling", "COMPANY", callGroup([{ property: "leadState", operator: "is_any_of", value: ["Calling"] }])],
    // Non-nullable columns: "is known / none of / not equal" must not compare with null
    ["company in a campaign with outcome none of Queued", "COMPANY", callGroup([{ property: "status", operator: "is_none_of", value: ["Queued"], association: "CAMPAIGN" }])],
    ["company with campaign calls ≠ 0", "COMPANY", callGroup([{ property: "attempts", operator: "neq", value: 0, association: "CAMPAIGN" }])],
    ["contact CRT count ≠ 0", "CONTACT", callGroup([{ property: "crtCount", operator: "neq", value: 0 }])],
    ["contact CRT count unknown (never)", "CONTACT", callGroup([{ property: "crtCount", operator: "is_unknown" }])],
    ["contact has a call with a known date", "CONTACT", callGroup([{ property: "occurredAt", operator: "is_known", association: "CALL" }])],
  ] as const) {
    const { total } = await fetchRows(object, buildWhere(object, null, st, "", ctx), null, 0, 1, defs[object]);
    console.log(`${total.toString().padStart(4)}  ${label}`);
  }

  // Segments: size, membership filter, and "not in segment"
  for (const seg of await db.segment.findMany()) {
    const object = seg.objectType as CrmObject;
    const { total } = await fetchRows(object, segmentRecordsWhere(object, seg.id, ctx), null, 0, 1, defs[object]);
    const inSeg = await fetchRows(object, buildWhere(object, null, { ...base, quick: { s: { property: SEGMENT_PROPERTY, operator: "is_any_of", value: [seg.id] } } }, "", ctx), null, 0, 1, defs[object]);
    const notIn = await fetchRows(object, buildWhere(object, null, { ...base, quick: { s: { property: SEGMENT_PROPERTY, operator: "is_none_of", value: [seg.id] } } }, "", ctx), null, 0, 1, defs[object]);
    console.log(`${total.toString().padStart(4)}  segment "${seg.name}" (${seg.type}); filter in=${inSeg.total} not-in=${notIn.total}`);
  }

  // Sorting by a custom (jsonb) property
  for (const direction of ["asc", "desc"] as const) {
    const { rows } = await fetchRows("CONTACT", buildWhere("CONTACT", null, base, "", ctx), { property: "researchResult", direction }, 0, 4, defs.CONTACT);
    console.log(`      sort researchResult ${direction}: ${rows.map((r) => r.values.researchResult ?? "∅").join(", ")}`);
  }

  // Advanced OR groups
  const adv: ViewState = {
    ...base,
    advanced: [
      { op: "AND", conditions: [{ property: "leadStatus", operator: "is_any_of", value: ["Connected"] }] },
      { op: "AND", conditions: [{ property: "crtCount", operator: "eq", value: 0 }, { property: "callable", operator: "is_any_of", value: ["Yes"] }] },
    ],
  };
  const { total } = await fetchRows("CONTACT", buildWhere("CONTACT", null, adv, "", ctx), null, 0, 1, defs.CONTACT);
  console.log(`${total.toString().padStart(4)}  advanced: Connected OR (CRT=0 AND callable)`);
  const s = await fetchRows("CONTACT", buildWhere("CONTACT", null, base, "8135550187", ctx), null, 0, 5, defs.CONTACT);
  console.log(`${s.total.toString().padStart(4)}  search by phone number 8135550187 → ${s.rows.map((r) => r.name).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
