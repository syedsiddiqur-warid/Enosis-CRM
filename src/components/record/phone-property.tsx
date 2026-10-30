"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Info, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, Select } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, Tooltip } from "@/components/ui/overlays";
import { deletePhoneNumber, savePhoneNumber } from "@/lib/crm/phone-actions";
import type { PropDef } from "@/lib/crm/types";
import { cn, formatPhone, splitPhone } from "@/lib/utils";
import { useRecord } from "./record-context";

/** ISO code, name, dial code. US first: +1 numbers default to it. */
const COUNTRIES: [string, string, string][] = [
  ["US", "United States", "1"],
  ["CA", "Canada", "1"],
  ["GB", "United Kingdom", "44"],
  ["IE", "Ireland", "353"],
  ["AU", "Australia", "61"],
  ["NZ", "New Zealand", "64"],
  ["DE", "Germany", "49"],
  ["FR", "France", "33"],
  ["NL", "Netherlands", "31"],
  ["BE", "Belgium", "32"],
  ["LU", "Luxembourg", "352"],
  ["CH", "Switzerland", "41"],
  ["AT", "Austria", "43"],
  ["DK", "Denmark", "45"],
  ["SE", "Sweden", "46"],
  ["NO", "Norway", "47"],
  ["FI", "Finland", "358"],
  ["IS", "Iceland", "354"],
  ["ES", "Spain", "34"],
  ["PT", "Portugal", "351"],
  ["IT", "Italy", "39"],
  ["PL", "Poland", "48"],
  ["CZ", "Czechia", "420"],
  ["EE", "Estonia", "372"],
  ["IL", "Israel", "972"],
  ["AE", "United Arab Emirates", "971"],
  ["SA", "Saudi Arabia", "966"],
  ["QA", "Qatar", "974"],
  ["IN", "India", "91"],
  ["BD", "Bangladesh", "880"],
  ["PK", "Pakistan", "92"],
  ["LK", "Sri Lanka", "94"],
  ["SG", "Singapore", "65"],
  ["MY", "Malaysia", "60"],
  ["PH", "Philippines", "63"],
  ["ID", "Indonesia", "62"],
  ["TH", "Thailand", "66"],
  ["VN", "Vietnam", "84"],
  ["HK", "Hong Kong", "852"],
  ["CN", "China", "86"],
  ["JP", "Japan", "81"],
  ["KR", "South Korea", "82"],
  ["ZA", "South Africa", "27"],
  ["NG", "Nigeria", "234"],
  ["KE", "Kenya", "254"],
  ["EG", "Egypt", "20"],
  ["BR", "Brazil", "55"],
  ["MX", "Mexico", "52"],
  ["AR", "Argentina", "54"],
  ["CL", "Chile", "56"],
  ["CO", "Colombia", "57"],
];
const BY_LONGEST_DIAL = [...COUNTRIES].sort((a, b) => b[2].length - a[2].length);
const dialOf = (iso: string) => COUNTRIES.find((c) => c[0] === iso)?.[2] ?? "1";

/** Country from the record's Country/Region value ("United Kingdom", "UK", "GB"), else US. */
function countryFor(name: unknown) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return "US";
  const alias: Record<string, string> = { usa: "US", "united states of america": "US", uk: "GB", england: "GB", uae: "AE" };
  return alias[n] ?? COUNTRIES.find((c) => c[0].toLowerCase() === n || c[1].toLowerCase() === n)?.[0] ?? "US";
}

interface Parts {
  country: string;
  national: string;
  extension: string;
  /** Kept as typed, without country formatting */
  raw: string;
  unformatted: boolean;
}

function parse(value: string | null, fallbackCountry: string): Parts {
  const { number, extension } = splitPhone(value);
  const digits = number.replace(/\D/g, "");
  const base = { extension: extension ?? "", raw: value ?? "", unformatted: false };
  if (!number) return { ...base, country: fallbackCountry, national: "" };
  if (number.startsWith("+")) {
    // +1 numbers keep the record's country when it is Canada
    const hit = fallbackCountry && digits.startsWith(dialOf(fallbackCountry)) ? COUNTRIES.find((c) => c[0] === fallbackCountry)! : BY_LONGEST_DIAL.find((c) => digits.startsWith(c[2]));
    if (hit) return { ...base, country: hit[0], national: digits.slice(hit[2].length) };
  } else if (digits.length === 10 && dialOf(fallbackCountry) === "1") {
    return { ...base, country: fallbackCountry, national: digits };
  }
  // Doesn't fit a country code: edit it as typed
  return { ...base, country: fallbackCountry, national: digits, unformatted: true };
}

function compose(p: Parts): { number: string; extension: string | null } | null {
  const extension = p.extension.replace(/\D/g, "") || null;
  if (p.unformatted) {
    const typed = splitPhone(p.raw);
    return typed.number.replace(/\D/g, "").length >= 4 ? typed : null;
  }
  const national = p.national.replace(/\D/g, "").replace(/^0+/, "");
  if (national.length < 4) return null;
  return { number: `+${dialOf(p.country)}${national}`, extension };
}

const asValue = (c: { number: string; extension: string | null }) => (c.extension ? `${c.number} ext. ${c.extension}` : c.number);

/** (813) 555-0100 while typing North American numbers; other countries as typed. */
function displayNational(dial: string, national: string) {
  const d = national.replace(/\D/g, "");
  if (dial !== "1" || d.length > 10) return national;
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** HubSpot-style phone editor: country code, number and extension, or the number as typed. */
export function PhoneEditor({
  title,
  value,
  defaultCountry,
  onSave,
  onCancel,
  children,
  footer,
}: {
  title: string;
  value: string | null;
  defaultCountry: string;
  onSave: (v: { number: string; extension: string | null } | null) => Promise<string | null>;
  onCancel: () => void;
  /** Extra fields under the number (type of an additional number) */
  children?: React.ReactNode;
  /** Extra buttons next to Save / Cancel */
  footer?: React.ReactNode;
}) {
  const [p, setP] = useState<Parts>(() => parse(value, defaultCountry));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const composed = compose(p);
  const dial = dialOf(p.country);
  const set = (patch: Partial<Parts>) => (setError(null), setP((x) => ({ ...x, ...patch })));

  return (
    <form
      className="w-[360px] p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!composed) return;
        setSaving(true);
        const err = await onSave(composed);
        setSaving(false);
        if (err) setError(err);
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <button type="button" className="rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink" onClick={onCancel} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="rounded-[6px] border border-line-strong p-2">
        {p.unformatted ? (
          <input
            className="h-9 w-full rounded-[3px] border border-line-strong bg-surface px-2.5 text-[14px] focus:border-link focus:outline-none"
            value={p.raw}
            onChange={(e) => set({ raw: e.target.value })}
            placeholder="Phone number"
            aria-label="Phone number"
            autoFocus
          />
        ) : (
          <div className="flex h-9 items-stretch overflow-hidden rounded-[3px] border border-line-strong bg-surface focus-within:border-link">
            <label className="relative flex shrink-0 items-center gap-1 border-r border-line-strong px-2.5 text-[13px] font-medium hover:bg-surface-hover">
              {p.country}
              <ChevronDown className="size-3.5 text-ink-muted" />
              <select
                className="absolute inset-0 cursor-pointer opacity-0"
                value={p.country}
                onChange={(e) => set({ country: e.target.value })}
                aria-label="Country code"
              >
                {COUNTRIES.map(([iso, name, code]) => (
                  <option key={iso} value={iso}>
                    {name} (+{code})
                  </option>
                ))}
              </select>
            </label>
            <span className="flex shrink-0 items-center pl-2.5 text-[14px] text-ink-muted">+{dial}</span>
            <input
              className="min-w-0 flex-1 bg-transparent px-1.5 text-[14px] tabular-nums focus:outline-none"
              value={displayNational(dial, p.national)}
              onChange={(e) => set({ national: e.target.value.replace(/[^\d\s()-]/g, "") })}
              inputMode="tel"
              aria-label="Phone number"
              autoFocus
            />
            <input
              className="w-[96px] shrink-0 border-l border-line-strong bg-transparent px-2.5 text-[14px] tabular-nums placeholder:text-ink-subtle focus:outline-none"
              value={p.extension}
              onChange={(e) => set({ extension: e.target.value.replace(/\D/g, "") })}
              placeholder="Extension"
              inputMode="numeric"
              aria-label="Extension"
            />
          </div>
        )}
        <p className={cn("mt-1.5 text-[12px] font-medium", error ? "text-danger" : "text-link")}>
          {error ?? (p.unformatted ? "Enter the number exactly as it should be saved." : "Select a country code and enter a phone number.")}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          className="text-[13px] font-semibold text-link hover:underline"
          onClick={() =>
            set(
              p.unformatted
                ? { ...parse(p.raw, p.country), unformatted: false }
                : { unformatted: true, raw: composed ? asValue(composed) : p.national },
            )
          }
        >
          {p.unformatted ? "Add number formatting" : "Remove number formatting"}
        </button>
        <Tooltip content={p.unformatted ? "Use a country code and format the number" : "Save the number exactly as you type it, for numbers that don't fit a country format"}>
          <Info className="size-3.5 text-ink-muted" aria-hidden />
        </Tooltip>
      </div>

      {children && <div className="mt-3">{children}</div>}

      <div className="mt-5 flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!composed || saving}>
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {footer && <div className="ml-auto flex items-center gap-1">{footer}</div>}
      </div>
    </form>
  );
}

type RecordPhone = ReturnType<typeof useRecord>["data"]["phones"][number];

/** A phone property on the record page. "Phone number" also lists the record's other numbers and adds more. */
export function PhoneProperty({ def, value, compact }: { def: PropDef; value: unknown; compact?: boolean }) {
  const { data, editProperty, toast, refresh } = useRecord();
  const primary = typeof value === "string" && value ? value : null;
  const multi = def.name === "phone";
  const primaryNumber = splitPhone(primary).number.replace(/\D/g, "");
  // The record's own lines (not its company's or a contact's) other than the main one
  const extras = multi
    ? data.phones.filter(
        (p) => (data.object === "CONTACT" ? p.contactId === data.id : !p.contactId) && p.number.replace(/\D/g, "") !== primaryNumber,
      )
    : [];
  const country = countryFor(data.values.country);
  const [open, setOpen] = useState<string | null>(null);

  async function saveExtra(row: RecordPhone | null, v: { number: string; extension: string | null }, type: string) {
    const res = await savePhoneNumber(data.object, data.id, row?.id ?? null, {
      number: v.number,
      extension: v.extension,
      type,
      status: row?.status ?? "Unknown",
      ivrPath: row?.ivrPath ?? null,
      notes: row?.notes ?? null,
      contactId: null,
    });
    if (!res.ok) return res.error;
    toast({ message: row ? "Phone number updated" : "Phone number added" });
    setOpen(null);
    refresh();
    return null;
  }

  async function makePrimary(row: RecordPhone) {
    const err = await editProperty(def.name, row.extension ? `${row.number} ext. ${row.extension}` : row.number);
    if (err) return toast({ message: err });
    // The old main number takes this row's place, so no number is lost
    const old = splitPhone(primary);
    const res = old.number
      ? await savePhoneNumber(data.object, data.id, row.id, { ...row, number: old.number, extension: old.extension, contactId: null })
      : await deletePhoneNumber(data.object, data.id, row.id);
    if (!res.ok) toast({ message: res.error });
    else toast({ message: `${formatPhone(row.number)} is now the main number` });
    setOpen(null);
    refresh();
  }

  async function remove(row: RecordPhone) {
    const res = await deletePhoneNumber(data.object, data.id, row.id);
    if (!res.ok) return toast({ message: res.error });
    const snap = res.data!;
    setOpen(null);
    toast({ message: `Deleted ${formatPhone(row.number)}`, undo: async () => void (await savePhoneNumber(data.object, data.id, null, snap), refresh()) });
    refresh();
  }

  const types = data.options.phoneType;
  const defaultType = data.object === "CONTACT" ? "Direct" : "Main";

  return (
    <div className={cn("group/phone", compact ? "py-1" : "py-1.5")}>
      <div className="flex items-center gap-1 text-[12px] text-ink-muted">
        <span className="truncate">{def.label}</span>
        {def.description && (
          <Tooltip content={def.description}>
            <Info className="size-3 shrink-0 text-ink-subtle" aria-label={def.description} />
          </Tooltip>
        )}
      </div>

      {(primary || !extras.length) && (
      <PhonePopover
        open={open === "primary"}
        onOpenChange={(o) => setOpen(o ? "primary" : null)}
        trigger={<PhoneLine value={primary} label={extras.length ? "Main" : null} editLabel={`Edit ${def.label}`} />}
      >
        <PhoneEditor
          title={primary ? `Edit ${def.label}` : `Add ${def.label}`}
          value={primary}
          defaultCountry={country}
          onCancel={() => setOpen(null)}
          onSave={async (v) => {
            const err = await editProperty(def.name, v ? asValue(v) : null);
            if (!err) setOpen(null);
            return err;
          }}
          footer={
            primary && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  const err = await editProperty(def.name, null);
                  if (err) return toast({ message: err });
                  setOpen(null);
                }}
              >
                Remove
              </Button>
            )
          }
        />
      </PhonePopover>
      )}

      {extras.map((row) => (
        <ExtraLine
          key={row.id}
          row={row}
          open={open === row.id}
          onOpenChange={(o) => setOpen(o ? row.id : null)}
          types={types}
          country={country}
          onSave={(v, type) => saveExtra(row, v, type)}
          onMakePrimary={() => makePrimary(row)}
          onRemove={() => remove(row)}
        />
      ))}

      {multi && (primary || extras.length > 0) && (
        <AddLine
          open={open === "new"}
          onOpenChange={(o) => setOpen(o ? "new" : null)}
          types={types}
          defaultType={defaultType}
          country={country}
          onSave={(v, type) => saveExtra(null, v, type)}
        />
      )}
    </div>
  );
}

function PhonePopover({ open, onOpenChange, trigger, children }: { open: boolean; onOpenChange: (o: boolean) => void; trigger: React.ReactNode; children: React.ReactNode }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenChange(true)}
          onKeyDown={(e) => e.key === "Enter" && onOpenChange(true)}
          className="group/line -mx-1.5 flex min-h-7 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-[3px] px-1.5 text-[13px] hover:bg-surface-hover"
        >
          {trigger}
        </div>
      </PopoverAnchor>
      {open && (
        <PopoverContent side="right" align="start" sideOffset={12} className="rounded-[8px]" onOpenAutoFocus={(e) => e.preventDefault()}>
          {children}
          <PopoverPrimitive.Arrow width={16} height={8} className="fill-surface stroke-line" />
        </PopoverContent>
      )}
    </Popover>
  );
}

function PhoneLine({ value, label, editLabel }: { value: string | null; label: string | null; editLabel: string }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5" title={editLabel}>
        <span className="truncate tabular-nums">{value ? formatPhone(value) : "--"}</span>
        {label && <span className="shrink-0 text-[12px] text-ink-subtle">{label}</span>}
      </span>
      <Pencil className="invisible size-3.5 shrink-0 text-ink-subtle group-hover/line:visible" />
    </>
  );
}

function TypeSelect({ types, value, onChange }: { types: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <span className="text-ink-muted">Type</span>
      <Select className="w-[140px]" value={value} onChange={(e) => onChange(e.target.value)}>
        {types.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ExtraLine({
  row,
  open,
  onOpenChange,
  types,
  country,
  onSave,
  onMakePrimary,
  onRemove,
}: {
  row: RecordPhone;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  types: { value: string; label: string }[];
  country: string;
  onSave: (v: { number: string; extension: string | null }, type: string) => Promise<string | null>;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  const [type, setType] = useState(row.type);
  const value = row.extension ? `${row.number} ext. ${row.extension}` : row.number;
  return (
    <PhonePopover
      open={open}
      onOpenChange={(o) => (o && setType(row.type), onOpenChange(o))}
      trigger={<PhoneLine value={value} label={row.type} editLabel="Edit phone number" />}
    >
      <PhoneEditor
        title="Edit Phone Number"
        value={value}
        defaultCountry={country}
        onCancel={() => onOpenChange(false)}
        onSave={(v) => (v ? onSave(v, type) : Promise.resolve(null))}
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" className="text-link" onClick={onMakePrimary}>
              Make main
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-danger" onClick={onRemove}>
              Remove
            </Button>
          </>
        }
      >
        <TypeSelect types={types} value={type} onChange={setType} />
      </PhoneEditor>
    </PhonePopover>
  );
}

function AddLine({
  open,
  onOpenChange,
  types,
  defaultType,
  country,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  types: { value: string; label: string }[];
  defaultType: string;
  country: string;
  onSave: (v: { number: string; extension: string | null }, type: string) => Promise<string | null>;
}) {
  const [type, setType] = useState(defaultType);
  return (
    <Popover open={open} onOpenChange={(o) => (o && setType(defaultType), onOpenChange(o))}>
      <PopoverAnchor asChild>
        <button
          type="button"
          className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-link hover:underline"
          onClick={() => onOpenChange(true)}
        >
          <Plus className="size-3.5" /> Add phone number
        </button>
      </PopoverAnchor>
      {open && (
        <PopoverContent side="right" align="start" sideOffset={12} className="rounded-[8px]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <PhoneEditor
            title="Add Phone Number"
            value={null}
            defaultCountry={country}
            onCancel={() => onOpenChange(false)}
            onSave={(v) => (v ? onSave(v, type) : Promise.resolve(null))}
          >
            <TypeSelect types={types} value={type} onChange={setType} />
          </PhoneEditor>
          <PopoverPrimitive.Arrow width={16} height={8} className="fill-surface stroke-line" />
        </PopoverContent>
      )}
    </Popover>
  );
}
