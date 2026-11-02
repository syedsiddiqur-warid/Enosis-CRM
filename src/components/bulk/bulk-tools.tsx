"use client";

// Bulk change dialogs and the runner that sends changes in chunks with a progress bar. Used by Companies,
// Contacts (index-page.tsx) and Leads (leads-page.tsx).
import { Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { CellEditor } from "@/components/index/cell-editor";
import { PropertyPicker } from "@/components/index/property-picker";
import { Button, Select } from "@/components/ui/button";
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { BULK_CHUNK, shareOut, shareSummary, type BulkItem, type BulkTarget } from "@/lib/crm/bulk";
import { applyBulk, finishBulk, undoBulk } from "@/lib/crm/bulk-actions";
import type { PropDef, UserLite } from "@/lib/crm/types";

type BulkObject = "COMPANY" | "CONTACT" | "LEAD";
type Progress = { label: string; done: number; total: number; undoing?: boolean };
export type BulkOutcome = { message: string; batchId: string | null };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Runs a bulk change in chunks and can undo it. `dialog` shows the progress while it runs. */
export function useBulkRunner(object: BulkObject, noun: { singular: string; plural: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);

  async function run(label: string, items: BulkItem[]): Promise<BulkOutcome> {
    const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let updated = 0;
    let unchanged = 0;
    const failed: string[] = [];
    setProgress({ label, done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i += BULK_CHUNK) {
        const res = await applyBulk(object, batchId, items.slice(i, i + BULK_CHUNK));
        if (!res.ok) return { message: `Stopped after ${plural(updated, noun.singular, noun.plural)}: ${res.error}`, batchId: updated ? batchId : null };
        updated += res.data!.updated;
        unchanged += res.data!.unchanged;
        failed.push(...res.data!.failed.map((f) => f.error));
        setProgress({ label, done: Math.min(i + BULK_CHUNK, items.length), total: items.length });
      }
      await finishBulk(object);
    } finally {
      setProgress(null);
    }
    const reasons = [...new Set(failed)].slice(0, 2).join("; ");
    return {
      message: [
        `Updated ${plural(updated, noun.singular, noun.plural)}`,
        unchanged && `${unchanged.toLocaleString()} already had ${unchanged === 1 ? "that value" : "those values"}`,
        failed.length && `${failed.length.toLocaleString()} couldn't be changed (${reasons})`,
      ]
        .filter(Boolean)
        .join(", "),
      batchId: updated ? batchId : null,
    };
  }

  async function undo(batchId: string): Promise<string> {
    let restored = 0;
    setProgress({ label: "Undoing", done: 0, total: 0, undoing: true });
    try {
      for (;;) {
        const res = await undoBulk(batchId);
        if (!res.ok) return `Undo stopped: ${res.error}`;
        restored += res.data!.restored;
        setProgress({ label: "Undoing", done: restored, total: restored + res.data!.remaining * BULK_CHUNK, undoing: true });
        if (!res.data!.remaining) break;
      }
    } finally {
      setProgress(null);
    }
    return `Undone: ${plural(restored, noun.singular, noun.plural)} put back`;
  }

  const dialog = (
    <Dialog open={!!progress}>
      <DialogContent title={progress?.label ?? ""} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <div className="space-y-3 px-6 py-5 text-[13px]">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-ink-muted" />
            {progress?.undoing ? `${progress.done.toLocaleString()} put back so far` : `${progress?.done.toLocaleString()} of ${progress?.total.toLocaleString()} ${noun.plural}`}
          </div>
          {!progress?.undoing && (
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full bg-[#00a4bd] transition-[width]" style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          )}
          <p className="text-ink-subtle">Keep this tab open until it finishes. Changes are saved as each batch completes.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
  return { run, undo, running: !!progress, dialog };
}

/** Share records out among several people (or give them all to one), evenly or keeping time zones together. */
export function BulkAssignDialog({
  open,
  onOpenChange,
  count,
  fields,
  users,
  loadTargets,
  onApply,
  canByZone = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number;
  /** Which user field to fill, e.g. Owner or Researcher */
  fields: { name: string; label: string }[];
  users: UserLite[];
  loadTargets: () => Promise<BulkTarget[] | null>;
  onApply: (field: { name: string; label: string }, plan: Map<string, string | null>, targets: BulkTarget[]) => void;
  canByZone?: boolean;
}) {
  const [field, setField] = useState(fields[0]?.name ?? "ownerId");
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<"even" | "timezone" | "none">("even");
  const [preview, setPreview] = useState<{ targets: BulkTarget[]; plan: Map<string, string> } | null>(null);
  const [loading, setLoading] = useState(false);
  const def = fields.find((f) => f.name === field) ?? fields[0];
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.email ?? "Unknown";

  const reset = () => {
    setPreview(null);
    setLoading(false);
  };
  async function showPreview() {
    setLoading(true);
    const targets = await loadTargets();
    setLoading(false);
    if (!targets) return;
    setPreview({ targets, plan: shareOut(targets, picked, mode === "timezone" ? "timezone" : "even") });
  }
  function apply() {
    if (!preview) return;
    const plan = new Map<string, string | null>();
    for (const t of preview.targets) plan.set(t.id, mode === "none" ? null : (preview.plan.get(t.id) ?? null));
    onApply(def, plan, preview.targets);
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent title={`Assign ${plural(count, "record", "records")}`} className="w-[560px]">
        <div className="thin-scroll max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5 text-[13px]">
          {fields.length > 1 && (
            <label className="block">
              <span className="mb-1 block font-medium">Field</span>
              <Select
                value={field}
                onChange={(e) => {
                  setField(e.target.value);
                  setPreview(null);
                }}
              >
                {fields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <div>
            <div className="mb-1 font-medium">People</div>
            <div className="thin-scroll flex max-h-[150px] flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto rounded-[3px] border border-line p-2">
              {users.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-[var(--link)]"
                    checked={picked.includes(u.id)}
                    disabled={mode === "none"}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setPicked((p) => (on ? [...p, u.id] : p.filter((x) => x !== u.id)));
                      setPreview(null);
                    }}
                  />
                  {u.name ?? u.email}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium">How</div>
            {(
              [
                ["even", "Share evenly", "Round robin, so everyone gets the same number"],
                ...(canByZone ? ([["timezone", "Keep time zones together", "Each person gets whole time zones where possible, still split evenly"]] as const) : []),
                ["none", "Clear it", `Leave ${def?.label.toLowerCase() ?? "the field"} empty`],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="bulk-assign-mode"
                  className="mt-0.5 accent-[var(--link)]"
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    setPreview(null);
                  }}
                />
                <span>
                  {label} <span className="text-ink-subtle">· {hint}</span>
                </span>
              </label>
            ))}
          </div>
          {preview && mode !== "none" && (
            <div className="rounded-[3px] bg-surface-muted p-3">
              <div className="mb-1 font-medium">
                {preview.targets.length.toLocaleString()} records to {def?.label.toLowerCase()}
              </div>
              <ul className="space-y-0.5">
                {[...shareSummary(preview.targets, preview.plan).entries()].map(([u, s]) => (
                  <li key={u}>
                    <span className="font-medium">{name(u)}</span>: {s.count.toLocaleString()}
                    {mode === "timezone" && (
                      <span className="text-ink-subtle">
                        {" "}
                        ({[...s.zones.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 4)
                          .map(([z, n]) => `${z.replace(/^America\//, "").replace(/_/g, " ")} ${n}`)
                          .join(", ")}
                        {s.zones.size > 4 ? ", …" : ""})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview && mode === "none" && <p className="rounded-[3px] bg-surface-muted p-3">{preview.targets.length.toLocaleString()} records will have no {def?.label.toLowerCase()}.</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" onClick={apply}>
              Assign {preview.targets.length.toLocaleString()}
            </Button>
          ) : (
            <Button variant="primary" disabled={loading || (mode !== "none" && !picked.length)} onClick={showPreview}>
              {loading && <Loader2 className="animate-spin" />} Preview
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Change several properties at once on every selected record. */
export function BulkEditDialog({
  open,
  onOpenChange,
  count,
  defs,
  groups,
  users,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number;
  defs: PropDef[];
  groups: { name: string; label: string }[];
  users: UserLite[];
  onApply: (changes: Record<string, unknown>, summary: string) => void;
}) {
  const [changes, setChanges] = useState<{ def: PropDef; value: unknown }[]>([]);
  const [adding, setAdding] = useState(false);
  const [editDef, setEditDef] = useState<PropDef | null>(null);
  const shown = (def: PropDef, v: unknown): string => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "(empty)";
    if (def.type === "USER") return users.find((u) => u.id === v)?.name ?? String(v);
    if (Array.isArray(v)) return v.map((x) => def.options?.find((o) => o.value === x)?.label ?? x).join(", ");
    return def.options?.find((o) => o.value === v)?.label ?? String(v);
  };
  const summary = changes.map((c) => `${c.def.label} → ${shown(c.def, c.value)}`).join(", ");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setChanges([]);
      }}
    >
      <DialogContent title={`Edit ${plural(count, "record", "records")}`} className="w-[560px]">
        <div className="space-y-3 px-6 py-5 text-[13px]">
          {changes.length ? (
            <ul className="divide-y divide-line rounded-[3px] border border-line">
              {changes.map((c) => (
                <li key={c.def.name} className="flex items-center gap-2 px-3 py-2">
                  <span className="font-medium">{c.def.label}</span>
                  <span className="text-ink-subtle">→</span>
                  <span className="min-w-0 flex-1 truncate">{shown(c.def, c.value)}</span>
                  <button aria-label={`Remove ${c.def.label}`} className="rounded p-1 text-ink-muted hover:bg-surface-hover" onClick={() => setChanges(changes.filter((x) => x.def.name !== c.def.name))}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">Add the properties to change. Every selected record gets the same values.</p>
          )}
          <Popover
            open={adding}
            onOpenChange={(o) => {
              setAdding(o);
              if (!o) setEditDef(null);
            }}
          >
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary">
                <Plus /> Add a property
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              {editDef ? (
                <div>
                  <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">Set {editDef.label}</div>
                  <CellEditor
                    def={editDef}
                    value={null}
                    users={users}
                    onCancel={() => setEditDef(null)}
                    onSave={(v) => {
                      setChanges([...changes.filter((x) => x.def.name !== editDef.name), { def: editDef, value: v }]);
                      setEditDef(null);
                      setAdding(false);
                    }}
                  />
                </div>
              ) : (
                <PropertyPicker defs={defs} groups={groups} exclude={(d) => d.isReadOnly || !!d.isVirtual || changes.some((c) => c.def.name === d.name)} onPick={setEditDef} />
              )}
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!changes.length}
            onClick={() => {
              onApply(Object.fromEntries(changes.map((c) => [c.def.name, c.value])), summary);
              onOpenChange(false);
              setChanges([]);
            }}
          >
            Apply to {count.toLocaleString()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
