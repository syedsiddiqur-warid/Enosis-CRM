"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { RELATIVE_PRESETS, formatDate } from "@/lib/crm/dates";
import {
  RELATED_LABELS,
  SEGMENT_PROPERTY,
  isRelated,
  type FilterCondition,
  type Operator,
  type PropDef,
  type PropOption,
  type RelatedDefs,
  type SegmentSummary,
  type UserLite,
} from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export type FilterKind = "enum" | "text" | "number" | "date" | "boolean";

/** Pseudo-property definition so segment membership can be edited like an enum filter. */
export function segmentFilterDef(segments: SegmentSummary[]): PropDef {
  return {
    name: SEGMENT_PROPERTY,
    label: "Segment membership",
    type: "ENUM",
    groupName: "segments",
    groupLabel: "Segments",
    isBuiltIn: true,
    isReadOnly: true,
    isVirtual: true,
    options: segments.map((s) => ({ value: s.id, label: `${s.name}${s.type === "ACTIVE" ? " (active)" : " (static)"}` })),
  };
}

/** Definition behind a condition: own property, associated object's property, related row field or segment. */
export function conditionDef(
  c: FilterCondition,
  sources: { defs: PropDef[]; associatedDefs: PropDef[]; relatedDefs: RelatedDefs; segDef: PropDef },
): PropDef | undefined {
  if (c.property === SEGMENT_PROPERTY) return sources.segDef;
  if (isRelated(c.association)) return sources.relatedDefs[c.association]?.find((d) => d.name === c.property);
  return (c.association ? sources.associatedDefs : sources.defs).find((d) => d.name === c.property);
}

/** "Call › ", "Company › " … label prefix for conditions that reach outside the record. */
export function conditionPrefix(c: FilterCondition): string {
  if (isRelated(c.association)) return `${RELATED_LABELS[c.association]} › `;
  if (c.association === "COMPANY") return "Company › ";
  if (c.association === "CONTACT") return "Contact › ";
  return "";
}

export function filterKind(def: PropDef): FilterKind {
  switch (def.type) {
    case "ENUM":
    case "MULTI_ENUM":
    case "RADIO":
    case "USER":
      return "enum";
    case "NUMBER":
    case "AUTO_NUMBER":
      return "number";
    case "DATE":
    case "DATETIME":
      return "date";
    case "BOOLEAN":
      return "boolean";
    default:
      return "text";
  }
}

export function enumOptions(def: PropDef, users: UserLite[]): PropOption[] {
  if (def.type === "USER") {
    return [
      { value: "__me__", label: "Me" },
      { value: "__none__", label: "No owner" },
      ...users.map((u) => ({ value: u.id, label: u.name ?? u.email })),
    ];
  }
  return def.options ?? [];
}

const OP_LABEL: Partial<Record<Operator, string>> = {
  is_any_of: "is any of",
  is_none_of: "is none of",
  is_all_of: "has all of",
  is_known: "is known",
  is_unknown: "is unknown",
  contains: "contains",
  not_contains: "doesn't contain",
  is: "is",
  starts_with: "starts with",
  ends_with: "ends with",
  eq: "is equal to",
  neq: "is not equal to",
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  between: "is between",
  on: "is",
  before: "is before",
  after: "is after",
  date_between: "is between",
  more_than_days_ago: "is more than X days ago",
  less_than_days_ago: "is less than X days ago",
};

/** Short human summary, e.g. "is any of New, Open" — used on chips and in the advanced panel. */
export function describeCondition(def: PropDef, c: FilterCondition, users: UserLite[]): string {
  if (c.operator === "is_known" || c.operator === "is_unknown") return OP_LABEL[c.operator]!;
  const v = c.value;
  const short = (labels: string[]) => (labels.length > 2 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", "));
  if (filterKind(def) === "enum") {
    const opts = enumOptions(def, users);
    const list = short((Array.isArray(v) ? v : []).map((x) => opts.find((o) => o.value === x)?.label ?? String(x)));
    return c.operator === "is_none_of" ? `none of ${list}` : c.operator === "is_all_of" ? `all of ${list}` : list;
  }
  // Text: a list of exact values
  if (c.operator === "is_any_of" || c.operator === "is_none_of") {
    const vals = Array.isArray(v) ? v.map(String) : [];
    return `${c.operator === "is_none_of" ? "is none of" : "is any of"} ${short(vals)}`;
  }
  if (c.operator === "relative") {
    const r = (v ?? {}) as { preset?: string; days?: number };
    if (r.preset === "last_x_days") return `Last ${r.days ?? 7} days`;
    return RELATIVE_PRESETS.find((p) => p.key === r.preset)?.label ?? "";
  }
  if (c.operator === "more_than_days_ago") return `more than ${v} days ago`;
  if (c.operator === "less_than_days_ago") return `less than ${v} days ago`;
  if (c.operator === "date_between" && Array.isArray(v)) return `${formatDate(v[0])} – ${formatDate(v[1])}`;
  if (["on", "before", "after"].includes(c.operator)) return `${c.operator === "on" ? "" : OP_LABEL[c.operator] + " "}${formatDate(String(v))}`;
  if (c.operator === "between" && Array.isArray(v)) return `between ${v[0]} and ${v[1]}`;
  if (c.operator === "is" && def.type === "BOOLEAN") return v === true || v === "true" ? "Yes" : "No";
  return `${OP_LABEL[c.operator] ?? c.operator} ${String(v ?? "")}`;
}

export function defaultCondition(def: PropDef): FilterCondition {
  const kind = filterKind(def);
  const operator: Operator = kind === "enum" ? "is_any_of" : kind === "date" ? "relative" : kind === "number" ? "eq" : kind === "boolean" ? "is" : "contains";
  return { property: def.name, operator, value: kind === "enum" ? [] : kind === "boolean" ? true : undefined };
}

interface EditorProps {
  def: PropDef;
  condition: FilterCondition | undefined;
  users: UserLite[];
  onChange: (c: FilterCondition | undefined) => void;
}

/** Filter editor body for one property, shown inside a chip popover or the advanced panel. */
export function FilterEditor(props: EditorProps) {
  const kind = filterKind(props.def);
  if (kind === "enum") return <EnumEditor {...props} />;
  if (kind === "date") return <DateEditor {...props} />;
  if (kind === "number") return <NumberEditor {...props} />;
  if (kind === "boolean") return <BooleanEditor {...props} />;
  return <TextEditor {...props} />;
}

function OperatorRadios({ value, options, onChange }: { value: Operator; options: Operator[]; onChange: (o: Operator) => void }) {
  return (
    <div className="space-y-1">
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="radio" className="accent-[var(--link)]" checked={value === o} onChange={() => onChange(o)} />
          {OP_LABEL[o]}
        </label>
      ))}
    </div>
  );
}

function EnumEditor({ def, condition, users, onChange }: EditorProps) {
  const [q, setQ] = useState("");
  const options = useMemo(() => enumOptions(def, users), [def, users]);
  const op = condition?.operator ?? "is_any_of";
  const selected = new Set((condition?.value as string[] | undefined) ?? []);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const allShownSelected = shown.length > 0 && shown.every((o) => selected.has(o.value));

  function setValues(next: Set<string>, operator: Operator = op) {
    if (operator === "is_known" || operator === "is_unknown") return onChange({ property: def.name, operator });
    onChange(next.size ? { property: def.name, operator, value: [...next] } : operator === "is_any_of" ? undefined : { property: def.name, operator, value: [] });
  }

  return (
    <div className="w-[280px]">
      <div className="border-b border-line p-3">
        <OperatorRadios
          value={op}
          options={
            def.name === SEGMENT_PROPERTY
              ? ["is_any_of", "is_none_of"]
              : def.type === "MULTI_ENUM"
                ? ["is_any_of", "is_all_of", "is_none_of", "is_known", "is_unknown"]
                : ["is_any_of", "is_none_of", "is_known", "is_unknown"]
          }
          onChange={(o) => setValues(selected, o)}
        />
      </div>
      {(op === "is_any_of" || op === "is_none_of" || op === "is_all_of") && (
        <>
          <div className="relative p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-7" />
          </div>
          <div className="thin-scroll max-h-[260px] overflow-y-auto pb-2">
            {shown.length > 1 && (
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] font-medium hover:bg-surface-hover">
                <Checkbox
                  checked={allShownSelected ? true : shown.some((o) => selected.has(o.value)) ? "indeterminate" : false}
                  onCheckedChange={() => {
                    const next = new Set(selected);
                    shown.forEach((o) => (allShownSelected ? next.delete(o.value) : next.add(o.value)));
                    setValues(next);
                  }}
                />
                Select all
              </label>
            )}
            {shown.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-hover">
                <Checkbox
                  checked={selected.has(o.value)}
                  onCheckedChange={(c) => {
                    const next = new Set(selected);
                    if (c) next.add(o.value);
                    else next.delete(o.value);
                    setValues(next);
                  }}
                />
                {o.color && <span className="size-2 rounded-full" style={{ background: o.color }} />}
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {!shown.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No matches</div>}
          </div>
        </>
      )}
    </div>
  );
}

function ApplyRow({ onApply, onClear, disabled }: { onApply: () => void; onClear: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-between border-t border-line px-3 py-2">
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
      <Button size="sm" variant="primary" onClick={onApply} disabled={disabled}>
        Apply
      </Button>
    </div>
  );
}

function DateEditor({ def, condition, onChange }: EditorProps) {
  const [op, setOp] = useState<Operator>(condition?.operator ?? "relative");
  const [preset, setPreset] = useState<string>((condition?.value as { preset?: string })?.preset ?? "");
  const [days, setDays] = useState<number>((condition?.value as { days?: number })?.days ?? 7);
  const initial = condition?.value;
  const [a, setA] = useState<string>(Array.isArray(initial) ? String(initial[0] ?? "") : typeof initial === "string" ? initial : typeof initial === "number" ? String(initial) : "");
  const [b, setB] = useState<string>(Array.isArray(initial) ? String(initial[1] ?? "") : "");

  function apply(nextOp = op, nextPreset = preset) {
    if (nextOp === "is_known" || nextOp === "is_unknown") return onChange({ property: def.name, operator: nextOp });
    if (nextOp === "relative") return nextPreset ? onChange({ property: def.name, operator: "relative", value: { preset: nextPreset, days } }) : undefined;
    if (nextOp === "date_between") return onChange({ property: def.name, operator: nextOp, value: [a, b] });
    if (nextOp === "more_than_days_ago" || nextOp === "less_than_days_ago") return onChange({ property: def.name, operator: nextOp, value: Number(a) });
    onChange({ property: def.name, operator: nextOp, value: a });
  }

  const custom: Operator[] = ["on", "before", "after", "date_between", "more_than_days_ago", "less_than_days_ago", "is_known", "is_unknown"];
  return (
    <div className="w-[300px]">
      <div className="thin-scroll max-h-[300px] overflow-y-auto py-1">
        {RELATIVE_PRESETS.map((p) => (
          <label key={p.key} className={cn("flex cursor-pointer gap-2 px-3 py-1.5 hover:bg-surface-hover", op === "relative" && preset === p.key && "bg-surface-hover")}>
            <input
              type="radio"
              className="mt-0.5 accent-[var(--link)]"
              checked={op === "relative" && preset === p.key}
              onChange={() => {
                setOp("relative");
                setPreset(p.key);
                if (!p.takesDays) apply("relative", p.key);
              }}
            />
            <span className="min-w-0">
              <span className="block text-[13px]">{p.label}</span>
              <span className="block text-[12px] text-ink-subtle">{p.help}</span>
              {p.takesDays && op === "relative" && preset === p.key && (
                <span className="mt-1 flex items-center gap-2 text-[12px]">
                  <Input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-7 w-20" />
                  days
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      <div className="space-y-2 border-t border-line p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Custom</div>
        <Select value={op === "relative" ? "" : op} onChange={(e) => setOp(e.target.value as Operator)}>
          <option value="" disabled>
            Choose a condition
          </option>
          {custom.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </Select>
        {(op === "on" || op === "before" || op === "after" || op === "date_between") && (
          <div className="flex items-center gap-2">
            <Input type="date" value={a} onChange={(e) => setA(e.target.value)} />
            {op === "date_between" && (
              <>
                <span className="text-[12px]">and</span>
                <Input type="date" value={b} onChange={(e) => setB(e.target.value)} />
              </>
            )}
          </div>
        )}
        {(op === "more_than_days_ago" || op === "less_than_days_ago") && (
          <div className="flex items-center gap-2 text-[13px]">
            <Input type="number" min={0} value={a} onChange={(e) => setA(e.target.value)} className="w-24" /> days ago
          </div>
        )}
      </div>
      <ApplyRow onApply={() => apply()} onClear={() => onChange(undefined)} disabled={op === "relative" && !preset} />
    </div>
  );
}

function NumberEditor({ def, condition, onChange }: EditorProps) {
  const [op, setOp] = useState<Operator>(condition?.operator ?? "eq");
  const v = condition?.value;
  const [a, setA] = useState(Array.isArray(v) ? String(v[0]) : v !== undefined ? String(v) : "");
  const [b, setB] = useState(Array.isArray(v) ? String(v[1]) : "");
  const ops: Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_known", "is_unknown"];
  return (
    <div className="w-[260px]">
      <div className="space-y-2 p-3">
        <Select value={op} onChange={(e) => setOp(e.target.value as Operator)}>
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </Select>
        {op !== "is_known" && op !== "is_unknown" && (
          <div className="flex items-center gap-2">
            <Input autoFocus type="number" value={a} onChange={(e) => setA(e.target.value)} />
            {op === "between" && (
              <>
                <span className="text-[12px]">and</span>
                <Input type="number" value={b} onChange={(e) => setB(e.target.value)} />
              </>
            )}
          </div>
        )}
      </div>
      <ApplyRow
        onClear={() => onChange(undefined)}
        onApply={() =>
          onChange(
            op === "is_known" || op === "is_unknown"
              ? { property: def.name, operator: op }
              : { property: def.name, operator: op, value: op === "between" ? [Number(a), Number(b)] : Number(a) },
          )
        }
        disabled={op !== "is_known" && op !== "is_unknown" && (a === "" || (op === "between" && b === ""))}
      />
    </div>
  );
}

/** Values pasted one per line (or separated by commas / semicolons), e.g. a list of company domains. */
const splitList = (s: string) => [...new Set(s.split(/[\n,;\t]+/).map((x) => x.trim()).filter(Boolean))];

function TextEditor({ def, condition, onChange }: EditorProps) {
  const [op, setOp] = useState<Operator>(condition?.operator ?? "contains");
  const [v, setV] = useState(Array.isArray(condition?.value) ? (condition!.value as string[]).join("\n") : String(condition?.value ?? ""));
  const ops: Operator[] = ["contains", "not_contains", "is", "is_any_of", "is_none_of", "starts_with", "ends_with", "is_known", "is_unknown"];
  const valueless = op === "is_known" || op === "is_unknown";
  const list = op === "is_any_of" || op === "is_none_of";
  const apply = () => onChange(valueless ? { property: def.name, operator: op } : { property: def.name, operator: op, value: list ? splitList(v) : v });
  return (
    <div className="w-[280px]">
      <div className="space-y-2 p-3">
        <Select value={op} onChange={(e) => setOp(e.target.value as Operator)}>
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </Select>
        {list ? (
          <>
            <textarea
              autoFocus
              value={v}
              onChange={(e) => setV(e.target.value)}
              rows={5}
              placeholder={"One value per line, e.g.\nacme.com\nglobex.com"}
              className="w-full rounded-[3px] border border-line-strong bg-surface-muted px-2.5 py-1.5 text-[13px] focus:border-link focus:bg-surface focus:outline-none"
            />
            <p className="text-[12px] text-ink-subtle">{splitList(v).length} value{splitList(v).length === 1 ? "" : "s"} · exact match, upper/lower case ignored</p>
          </>
        ) : (
          !valueless && <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v && apply()} />
        )}
      </div>
      <ApplyRow onClear={() => onChange(undefined)} onApply={apply} disabled={!valueless && !(list ? splitList(v).length : v)} />
    </div>
  );
}

function BooleanEditor({ def, condition, onChange }: EditorProps) {
  const value = condition?.value === true || condition?.value === "true";
  return (
    <div className="w-[200px] space-y-1 p-3">
      {[true, false].map((b) => (
        <label key={String(b)} className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="radio" className="accent-[var(--link)]" checked={!!condition && value === b} onChange={() => onChange({ property: def.name, operator: "is", value: b })} />
          {b ? "Yes" : "No"}
        </label>
      ))}
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => onChange(undefined)}>
        Clear
      </Button>
    </div>
  );
}
