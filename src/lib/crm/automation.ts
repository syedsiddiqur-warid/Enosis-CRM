// Minimal evaluator for AutomationRule rows triggered by logged activities (§6 automations).
// The full rule builder (more triggers and actions) is part of build step 11.
import { db } from "@/lib/db";
import { applyUpdate, readRecord } from "./record-writes";
import type { CrmObject } from "./types";

interface RuleCondition {
  property: string;
  operator: string;
  value?: unknown;
}

function matches(c: RuleCondition, context: Record<string, unknown>) {
  const v = context[c.property];
  const s = v === null || v === undefined ? "" : String(v);
  switch (c.operator) {
    case "eq":
      return Number(v) === Number(c.value);
    case "neq":
      return Number(v) !== Number(c.value);
    case "gt":
      return Number(v) > Number(c.value);
    case "is":
      return s === String(c.value);
    case "starts_with":
      return s.toLowerCase().startsWith(String(c.value).toLowerCase());
    case "contains":
      return s.toLowerCase().includes(String(c.value).toLowerCase());
    case "is_any_of":
      return Array.isArray(c.value) && c.value.map(String).includes(s);
    case "is_none_of":
      return Array.isArray(c.value) && !c.value.map(String).includes(s);
    case "is_known":
      return s !== "";
    case "is_unknown":
      return s === "";
    default:
      return false;
  }
}

/** Run "activity logged" rules for one record. Rule conditions see the record's properties and the activity's fields. */
export async function runActivityRules(object: CrmObject, recordId: string, activity: { type: string } & Record<string, unknown>, userId: string) {
  const rules = await db.automationRule.findMany({ where: { objectType: object, isActive: true }, orderBy: { order: "asc" } });
  const applied: string[] = [];
  for (const rule of rules) {
    const trigger = rule.trigger as { kind?: string; activityType?: string };
    if (trigger.kind !== "activity_logged" || (trigger.activityType && trigger.activityType !== activity.type)) continue;
    // Re-read each time: an earlier rule may have changed the record
    const record = (await readRecord(object, recordId)) as unknown as Record<string, unknown> & { properties: Record<string, unknown> };
    const context = { ...record.properties, ...record, ...activity };
    const cond = (rule.conditions ?? {}) as { op?: "AND" | "OR"; conditions?: RuleCondition[] };
    const list = cond.conditions ?? [];
    const ok = !list.length || (cond.op === "OR" ? list.some((c) => matches(c, context)) : list.every((c) => matches(c, context)));
    if (!ok) continue;
    for (const action of (rule.actions as { kind: string; property?: string; value?: unknown; target?: string }[]) ?? []) {
      if (action.kind === "set_property" && action.property && !action.target) {
        if (await applyUpdate(object, recordId, action.property, action.value, userId, { rule: rule.name })) applied.push(rule.name);
      }
    }
  }
  return applied;
}
