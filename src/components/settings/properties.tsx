"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CreatePropertyDialog } from "@/components/index/dialogs";
import { Pill } from "@/components/index/values";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { setPropertyArchived, updatePropertyDefinition } from "@/lib/crm/settings-actions";
import type { CrmObject, PropOption, PropType } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { OptionsEditor } from "./options-editor";
import { SettingsPage } from "./settings-ui";

type Prop = {
  name: string;
  label: string;
  description: string | null;
  type: PropType;
  groupName: string | null;
  groupLabel: string | null;
  isBuiltIn: boolean;
  isReadOnly: boolean;
  isVirtual: boolean;
  options: PropOption[] | null;
  archived: boolean;
};

const TYPE_LABEL: Partial<Record<PropType, string>> = {
  TEXT: "Single-line text",
  TEXTAREA: "Multi-line text",
  RICH_TEXT: "Rich text",
  NUMBER: "Number",
  DATE: "Date",
  DATETIME: "Date and time",
  ENUM: "Dropdown",
  MULTI_ENUM: "Multi-select",
  RADIO: "Radio",
  BOOLEAN: "Checkbox",
  USER: "User",
  PHONE: "Phone",
  EMAIL: "Email",
  URL: "URL",
};
const hasOptions = (t: PropType) => t === "ENUM" || t === "MULTI_ENUM" || t === "RADIO";

export function PropertiesSettings({ object, groups, properties, canEdit }: { object: CrmObject; groups: { name: string; label: string }[]; properties: Prop[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Prop | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const plural = object === "CONTACT" ? "contacts" : "companies";

  const shown = properties.filter(
    (p) => p.archived === showArchived && (!group || p.groupName === group) && (`${p.label} ${p.name}`.toLowerCase().includes(q.trim().toLowerCase())),
  );

  return (
    <SettingsPage
      title="Properties"
      description="Fields stored on contacts and companies. Groups drive the record-page cards and the column picker. Custom properties are filterable, sortable and importable as soon as you create them."
      actions={
        canEdit && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus /> Create property
          </Button>
        )
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[4px] border border-line text-[13px]">
          {(["contacts", "companies"] as const).map((o) => (
            <Link key={o} href={`/settings/properties?object=${o}`} className={cn("px-3 py-1.5 capitalize", plural === o ? "bg-[#e5f5f8] font-medium" : "text-ink-muted hover:bg-surface-hover")}>
              {o === "contacts" ? "Contact" : "Company"} properties
            </Link>
          ))}
        </div>
        <div className="relative w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search properties" className="pl-8" aria-label="Search properties" />
        </div>
        <Select className="w-[200px]" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.label}
            </option>
          ))}
        </Select>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[13px]">
          <input type="checkbox" className="accent-[var(--link)]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived ({properties.filter((p) => p.archived).length})
        </label>
      </div>
      {error && <p className="mb-3 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="thin-scroll overflow-x-auto rounded-[4px] border border-line">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2">Property</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.name} className="border-t border-line">
                <td className="max-w-[360px] px-3 py-2">
                  <button className="text-left font-medium text-link hover:underline disabled:text-ink disabled:no-underline" disabled={!canEdit} onClick={() => setEditing(p)}>
                    {p.label}
                  </button>
                  <div className="font-mono text-[11px] text-ink-subtle">{p.name}</div>
                  {p.description && <div className="truncate text-[12px] text-ink-muted">{p.description}</div>}
                </td>
                <td className="px-3 py-2 text-ink-muted">
                  {TYPE_LABEL[p.type] ?? p.type}
                  {hasOptions(p.type) && p.options && <span className="text-ink-subtle"> · {p.options.filter((o) => !o.archived).length} options</span>}
                </td>
                <td className="px-3 py-2 text-ink-muted">{p.groupLabel ?? "--"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Pill label={p.isBuiltIn ? "Built-in" : "Custom"} color={p.isBuiltIn ? "#7c98b6" : "#00a4bd"} />
                    {(p.isReadOnly || p.isVirtual) && <Pill label="Calculated" />}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {canEdit && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      {!p.isBuiltIn && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              setError(null);
                              const res = await setPropertyArchived(object, p.name, !p.archived);
                              if (!res.ok) return setError(res.error);
                              router.refresh();
                            })
                          }
                        >
                          {p.archived ? "Restore" : "Archive"}
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="px-3 py-6 text-center text-[13px] text-ink-subtle">No properties match</p>}
      </div>
      <p className="mt-2 text-[12px] text-ink-subtle">
        Archived properties disappear from records, filters and imports; their values are kept and come back if you restore them. Built-in properties can be renamed and their options edited, but not archived.
      </p>

      <CreatePropertyDialog object={object} groups={groups} open={createOpen} onOpenChange={setCreateOpen} onCreated={() => router.refresh()} />
      {editing && (
        <EditPropertyDialog
          object={object}
          prop={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </SettingsPage>
  );
}

function EditPropertyDialog({ object, prop, groups, onClose, onSaved }: { object: CrmObject; prop: Prop; groups: { name: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(prop.label);
  const [description, setDescription] = useState(prop.description ?? "");
  const [groupName, setGroupName] = useState(prop.groupName ?? groups[0]?.name ?? "");
  const [options, setOptions] = useState<PropOption[]>(prop.options ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = new Set((prop.options ?? []).map((o) => o.value));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title={`Edit ${prop.label}`} className="w-[520px]">
        <form
          className="thin-scroll flex-1 space-y-4 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await updatePropertyDefinition(object, prop.name, {
                label,
                description,
                groupName,
                ...(hasOptions(prop.type) ? { options } : {}),
              });
              if (!res.ok) return setError(res.error);
              onSaved();
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div className="text-[12px] text-ink-muted">
            Internal name <span className="font-mono">{prop.name}</span> · {TYPE_LABEL[prop.type] ?? prop.type} · {prop.isBuiltIn ? "built-in" : "custom"}
          </div>
          <div>
            <Label htmlFor="pe-label">Label</Label>
            <Input id="pe-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label htmlFor="pe-desc">Description (shown as a tooltip)</Label>
            <textarea id="pe-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-link" />
          </div>
          <div>
            <Label htmlFor="pe-group">Group</Label>
            <Select id="pe-group" value={groupName} onChange={(e) => setGroupName(e.target.value)}>
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
          {hasOptions(prop.type) && (
            <div>
              <div className="mb-1 text-[12px] font-medium">Options</div>
              <OptionsEditor options={options} saved={saved} onChange={setOptions} />
              <p className="mt-1 text-[12px] text-ink-subtle">Renaming keeps the stored value, so existing records and filters keep working. Archive options you no longer use.</p>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
