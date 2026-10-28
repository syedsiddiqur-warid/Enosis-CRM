import type { ColumnSpec, FilterCondition, FilterGroup, SortSpec, ViewState } from "./types";

interface ViewRowLike {
  filters: unknown;
  quickFilters: unknown;
  columns: unknown;
  sort: unknown;
}

/** Read the persisted parts of a SavedView row into a ViewState. */
export function viewStateFromRow(row: ViewRowLike): ViewState {
  const filters = (row.filters ?? {}) as { quick?: Record<string, FilterCondition>; advanced?: FilterGroup[] };
  const sort = (row.sort as SortSpec[] | null)?.[0] ?? null;
  return {
    quick: filters.quick ?? {},
    advanced: filters.advanced ?? [],
    chips: (row.quickFilters as string[] | null) ?? [],
    columns: (row.columns as ColumnSpec[] | null) ?? [],
    sort,
  };
}

export function sameState(a: ViewState, b: ViewState) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(s: ViewState) {
  return {
    quick: Object.keys(s.quick)
      .sort()
      .map((k) => [k, s.quick[k]]),
    advanced: s.advanced,
    chips: s.chips,
    columns: s.columns.map((c) => [c.property, c.width ?? null, !!c.frozen]),
    sort: s.sort,
  };
}

/** Whether a condition actually filters anything (vs. an empty chip). */
export function isActiveCondition(c: FilterCondition | undefined) {
  if (!c) return false;
  if (c.operator === "is_known" || c.operator === "is_unknown") return true;
  const v = c.value;
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0 && v.every((x) => x !== "" && x !== null && x !== undefined);
  return true;
}
