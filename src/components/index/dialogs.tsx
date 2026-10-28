"use client";

import { ArrowDown, ArrowUp, GripVertical, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Checkbox, Dialog, DialogContent } from "@/components/ui/overlays";
import { createCompany, createContact, createProperty, searchCompanies } from "@/lib/crm/actions";
import { INDUSTRIES, LEAD_STATUSES, LIFECYCLE_STAGES } from "@/lib/crm/defaults";
import type { ColumnSpec, CrmObject, PropDef, PropType, UserLite } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null;
}

// ── Create record (right-side panel, like HubSpot) ──

export function CreateRecordDialog({ object, open, onOpenChange, users, currentUserId }: { object: CrmObject; open: boolean; onOpenChange: (o: boolean) => void; users: UserLite[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [companyQ, setCompanyQ] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string; domain: string | null }[]>([]);

  useEffect(() => {
    if (open) {
      setForm({ ownerId: currentUserId, lifecycleStage: "Lead", leadStatus: "New" });
      setError(null);
      setCompanyQ("");
    }
  }, [open, currentUserId]);

  useEffect(() => {
    if (object !== "CONTACT" || !open) return;
    const t = setTimeout(() => searchCompanies(companyQ).then(setCompanies), 150);
    return () => clearTimeout(t);
  }, [companyQ, object, open]);

  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(another: boolean) {
    setError(null);
    start(async () => {
      const res = object === "CONTACT" ? await createContact(form) : await createCompany(form as { name: string });
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (another) setForm({ ownerId: currentUserId, lifecycleStage: "Lead", leadStatus: "New" });
      else onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title={object === "CONTACT" ? "Create Contact" : "Create Company"}>
        <form
          className="thin-scroll flex-1 space-y-4 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <ErrorText error={error} />
          {object === "CONTACT" ? (
            <>
              <div>
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={form.email ?? ""} onChange={set("email")} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="c-first">First name</Label>
                  <Input id="c-first" value={form.firstName ?? ""} onChange={set("firstName")} />
                </div>
                <div>
                  <Label htmlFor="c-last">Last name</Label>
                  <Input id="c-last" value={form.lastName ?? ""} onChange={set("lastName")} />
                </div>
              </div>
              <div>
                <Label htmlFor="c-title">Job title</Label>
                <Input id="c-title" value={form.jobTitle ?? ""} onChange={set("jobTitle")} />
              </div>
              <div>
                <Label htmlFor="c-phone">Phone number</Label>
                <Input id="c-phone" value={form.phone ?? ""} onChange={set("phone")} placeholder="+1 555 123 4567" />
              </div>
              <div>
                <Label htmlFor="c-company">Primary company</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
                  <Input id="c-company" value={companyQ} onChange={(e) => setCompanyQ(e.target.value)} placeholder="Search companies" className="pl-7" />
                </div>
                <div className="thin-scroll mt-1 max-h-32 overflow-y-auto rounded-[3px] border border-line">
                  {companies.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px] hover:bg-surface-hover">
                      <input type="radio" name="company" className="accent-[var(--link)]" checked={form.companyId === c.id} onChange={() => setForm((f) => ({ ...f, companyId: c.id }))} />
                      <span className="truncate">{c.name}</span>
                      <span className="truncate text-[12px] text-ink-subtle">{c.domain}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="c-lifecycle">Lifecycle stage</Label>
                <Select id="c-lifecycle" value={form.lifecycleStage ?? ""} onChange={set("lifecycleStage")}>
                  {LIFECYCLE_STAGES.map((o) => (
                    <option key={o.value}>{o.value}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="c-status">Lead status</Label>
                <Select id="c-status" value={form.leadStatus ?? ""} onChange={set("leadStatus")}>
                  {LEAD_STATUSES.map((o) => (
                    <option key={o.value}>{o.value}</option>
                  ))}
                </Select>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="co-domain">Company domain name</Label>
                <Input id="co-domain" value={form.domain ?? ""} onChange={set("domain")} placeholder="example.com" autoFocus />
              </div>
              <div>
                <Label htmlFor="co-name">Company name *</Label>
                <Input id="co-name" required value={form.name ?? ""} onChange={set("name")} />
              </div>
              <div>
                <Label htmlFor="co-industry">Industry</Label>
                <Select id="co-industry" value={form.industry ?? ""} onChange={set("industry")}>
                  <option value="">--</option>
                  {INDUSTRIES.map((o) => (
                    <option key={o.value}>{o.value}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="co-phone">Phone number</Label>
                <Input id="co-phone" value={form.phone ?? ""} onChange={set("phone")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="co-city">City</Label>
                  <Input id="co-city" value={form.city ?? ""} onChange={set("city")} />
                </div>
                <div>
                  <Label htmlFor="co-country">Country/Region</Label>
                  <Input id="co-country" value={form.country ?? ""} onChange={set("country")} />
                </div>
              </div>
            </>
          )}
          <div>
            <Label htmlFor="r-owner">{object === "CONTACT" ? "Contact owner" : "Company owner"}</Label>
            <Select id="r-owner" value={form.ownerId ?? ""} onChange={set("ownerId")}>
              <option value="">No owner</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" hidden />
        </form>
        <div className="flex gap-2 border-t border-line px-6 py-4">
          <Button variant="primary" disabled={pending} onClick={() => submit(false)}>
            Create
          </Button>
          <Button disabled={pending} onClick={() => submit(true)}>
            Create and add another
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create property ──

const TYPE_CHOICES: { value: PropType; label: string }[] = [
  { value: "TEXT", label: "Single-line text" },
  { value: "TEXTAREA", label: "Multi-line text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date picker" },
  { value: "ENUM", label: "Dropdown select" },
  { value: "MULTI_ENUM", label: "Multiple checkboxes" },
  { value: "BOOLEAN", label: "Single checkbox" },
  { value: "USER", label: "User (owner)" },
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Phone number" },
  { value: "URL", label: "URL" },
];

export function CreatePropertyDialog({
  object,
  groups,
  open,
  onOpenChange,
  onCreated,
}: {
  object: CrmObject;
  groups: { name: string; label: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (name: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<PropType>("TEXT");
  const [group, setGroup] = useState(groups[0]?.name ?? "");
  const [options, setOptions] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setLabel("");
      setType("TEXT");
      setOptions("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  const needsOptions = type === "ENUM" || type === "MULTI_ENUM";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create property">
        <div className="space-y-4 px-6 py-5">
          <ErrorText error={error} />
          <div>
            <Label htmlFor="p-label">Label *</Label>
            <Input id="p-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-group">Group</Label>
              <Select id="p-group" value={group} onChange={(e) => setGroup(e.target.value)}>
                {groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="p-type">Field type</Label>
              <Select id="p-type" value={type} onChange={(e) => setType(e.target.value as PropType)}>
                {TYPE_CHOICES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {needsOptions && (
            <div>
              <Label htmlFor="p-options">Options (one per line)</Label>
              <textarea
                id="p-options"
                rows={4}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] focus:border-link focus:outline-none"
              />
            </div>
          )}
          <div>
            <Label htmlFor="p-desc">Description</Label>
            <Input id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-[12px] text-ink-subtle">Stored as a custom property: filterable and exportable right away, no migration needed. More types and validation rules come with Settings → Properties.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={pending || !label.trim()}
            onClick={() =>
              start(async () => {
                const res = await createProperty(object, { label, type, group, options: options.split("\n"), description });
                if (!res.ok) return setError(res.error);
                router.refresh();
                onCreated(res.data!.name);
                onOpenChange(false);
              })
            }
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit columns (two-pane, like HubSpot) ──

export function EditColumnsDialog({
  defs,
  groups,
  columns,
  open,
  onOpenChange,
  onApply,
}: {
  defs: PropDef[];
  groups: { name: string; label: string }[];
  columns: ColumnSpec[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApply: (cols: ColumnSpec[]) => void;
}) {
  const [draft, setDraft] = useState<ColumnSpec[]>(columns);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(columns);
      setQ("");
    }
  }, [open, columns]);
  const chosen = new Set(draft.map((c) => c.property));
  const byGroup = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, items: defs.filter((d) => d.groupName === g.name && d.label.toLowerCase().includes(q.toLowerCase())) }))
        .filter((g) => g.items.length),
    [defs, groups, q],
  );
  const label = (name: string) => defs.find((d) => d.name === name)?.label ?? name;
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const n = [...d];
      const j = i + dir;
      if (j < 0 || j >= n.length) return d;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Choose which columns you see" className="w-[760px]">
        <div className="grid h-[440px] grid-cols-[1fr_280px] divide-x divide-line">
          <div className="flex min-h-0 flex-col">
            <div className="relative p-4 pb-2">
              <Search className="pointer-events-none absolute left-6 top-1/2 mt-1 size-3.5 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search properties" className="pl-7" autoFocus />
            </div>
            <div className="thin-scroll grid flex-1 grid-cols-2 content-start gap-x-4 overflow-y-auto px-4 pb-4">
              {byGroup.map((g) => (
                <div key={g.name} className="col-span-2">
                  <div className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{g.label}</div>
                  <div className="grid grid-cols-2 gap-x-4">
                    {g.items.map((d) => (
                      <label key={d.name} className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
                        <Checkbox
                          checked={chosen.has(d.name)}
                          onCheckedChange={(c) => setDraft((cur) => (c ? [...cur, { property: d.name }] : cur.filter((x) => x.property !== d.name)))}
                        />
                        <span className="truncate">{d.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="px-4 pb-2 pt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Selected columns ({draft.length + 1})</div>
            <div className="thin-scroll flex-1 space-y-1 overflow-y-auto px-4 pb-4">
              <div className="flex h-8 items-center gap-2 rounded-[3px] border border-line bg-surface-muted px-2 text-[13px] text-ink-muted">
                <GripVertical className="size-3.5 opacity-40" /> Name <span className="ml-auto text-[11px]">locked</span>
              </div>
              {draft.map((c, i) => (
                <div key={c.property} className="flex h-8 items-center gap-1 rounded-[3px] border border-line bg-surface px-2 text-[13px]">
                  <span className="flex-1 truncate">{label(c.property)}</span>
                  <button className="rounded p-0.5 hover:bg-surface-hover disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-surface-hover disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label="Move down">
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-surface-hover" onClick={() => setDraft((d) => d.filter((x) => x.property !== c.property))} aria-label="Remove column">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 border-t border-line px-6 py-3">
          <Button
            variant="primary"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="link" className="ml-auto" onClick={() => setDraft([])}>
            Remove all columns
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Name / share a view ──

export function ViewNameDialog({
  open,
  onOpenChange,
  title,
  initialName,
  initialVisibility,
  initialTeamId = null,
  teams = [],
  showVisibility,
  nameLabel = "View name",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initialName: string;
  initialVisibility: "PRIVATE" | "TEAM" | "EVERYONE";
  initialTeamId?: string | null;
  /** Teams the view can be shared with */
  teams?: { id: string; name: string }[];
  showVisibility: boolean;
  nameLabel?: string;
  onSubmit: (name: string, visibility: "PRIVATE" | "TEAM" | "EVERYONE", teamId: string | null) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (open) {
      setName(initialName);
      setVisibility(initialVisibility);
      setTeamId(initialTeamId ?? teams[0]?.id ?? null);
      setError(null);
    }
    // teams is a fresh array each render; the first team only matters when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName, initialVisibility, initialTeamId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const err = await onSubmit(name, visibility, visibility === "TEAM" ? teamId : null);
              if (err) setError(err);
              else onOpenChange(false);
            });
          }}
        >
          <ErrorText error={error} />
          <div>
            <Label htmlFor="v-name">{nameLabel}</Label>
            <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
          </div>
          {showVisibility && (
            <fieldset>
              <legend className="mb-1 text-[12px] font-medium">Sharing</legend>
              {(
                [
                  ["PRIVATE", "Private", "Only you can see this view"],
                  ["TEAM", "A team", teams.length ? "Everyone on the team you pick" : "You aren't on a team yet"],
                  ["EVERYONE", "Everyone", "Everyone in the workspace"],
                ] as const
              ).map(([v, l, help]) => (
                <label key={v} className={cn("flex gap-2 py-1", v === "TEAM" && !teams.length ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                  <input
                    type="radio"
                    className="mt-0.5 accent-[var(--link)]"
                    checked={visibility === v}
                    disabled={v === "TEAM" && !teams.length}
                    onChange={() => setVisibility(v)}
                  />
                  <span className="flex-1">
                    <span className="block text-[13px]">{l}</span>
                    <span className="block text-[12px] text-ink-subtle">{help}</span>
                    {v === "TEAM" && visibility === "TEAM" && teams.length > 0 && (
                      <Select className="mt-1.5" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
