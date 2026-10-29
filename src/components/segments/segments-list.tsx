"use client";

import { MoreHorizontal, Plus, Search, Zap, ListChecks } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pill } from "@/components/index/values";
import { Button, Input, Label, Select } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { formatDate } from "@/lib/crm/dates";
import {
  cloneSegment,
  createSegment,
  deleteSegment,
} from "@/lib/crm/segment-actions";
import type { SegmentListRow } from "@/lib/crm/segments";
import type { CrmObject } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { SegmentCompare } from "./segment-compare";

const OBJECT_NAMES: Partial<Record<CrmObject, string>> = {
  CONTACT: "Contacts",
  COMPANY: "Companies",
};

export function TypePill({ type }: { type: "ACTIVE" | "STATIC" }) {
  return type === "ACTIVE" ? (
    <Pill label="Active" color="#00bda5" />
  ) : (
    <Pill label="Static" color="#7c98b6" />
  );
}

export function SegmentsList({ rows }: { rows: SegmentListRow[] }) {
  const router = useRouter();
  const [section, setSection] = useState<"manage" | "analyze">("manage");
  const [tab, setTab] = useState<"all" | "mine" | CrmObject>("all");
  const [typeFilter, setTypeFilter] = useState<"" | "ACTIVE" | "STATIC">("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<SegmentListRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const shown = rows.filter(
    (r) =>
      (tab === "all" || (tab === "mine" ? r.isOwn : r.objectType === tab)) &&
      (!typeFilter || r.type === typeFilter) &&
      `${r.name} ${r.description ?? ""}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const tabs: [typeof tab, string, number][] = [
    ["all", "All segments", rows.length],
    ["mine", "Created by me", rows.filter((r) => r.isOwn).length],
    [
      "CONTACT",
      "Contact segments",
      rows.filter((r) => r.objectType === "CONTACT").length,
    ],
    [
      "COMPANY",
      "Company segments",
      rows.filter((r) => r.objectType === "COMPANY").length,
    ],
  ];

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      <div className="flex items-center gap-2 px-6 pb-2 pt-4">
        <h1 className="text-[22px] font-medium">Segments</h1>
        <span className="text-[13px] text-ink-subtle">
          {rows.length} segments
        </span>
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => setCreateOpen(true)}
        >
          <Plus /> Create segment
        </Button>
      </div>
      <p className="px-6 pb-2 text-[13px] text-ink-muted">
        Active segments update automatically from their filters. Static segments
        only change when you add or remove records. Use them for call lists,
        campaign batches and exports.
      </p>

      <div className="flex gap-4 border-b border-line px-6">
        {(
          [
            ["manage", "Manage"],
            ["analyze", "Analyze"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2 pt-1 text-[14px]",
              section === k
                ? "border-link font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "analyze" ? (
        <SegmentCompare rows={rows} />
      ) : (
        <>
          <div className="flex items-end gap-1 border-b border-line px-6 pt-3">
            {tabs.map(([k, label, n]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-t-[4px] border border-b-0 px-3 text-[13px]",
                  tab === k
                    ? "-mb-px border-line bg-surface font-medium"
                    : "border-transparent text-ink-muted hover:bg-surface-hover",
                )}
              >
                {label} <span className="text-ink-subtle">({n})</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 px-6 py-3">
            <div className="relative w-[260px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search segments"
                className="pl-8"
                aria-label="Search segments"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as typeof typeFilter)
              }
              className="w-auto"
              aria-label="Segment type"
            >
              <option value="">All types</option>
              <option value="ACTIVE">Active</option>
              <option value="STATIC">Static</option>
            </Select>
            {error && <span className="text-[13px] text-danger">{error}</span>}
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-auto border-t border-line">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[11px] uppercase tracking-wide">
                <tr>
                  {[
                    "Name",
                    "Object",
                    "Type",
                    "Size",
                    "% of database",
                    "7-day change",
                    "Owner",
                    "Last updated",
                    "",
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={cn(
                        "h-10 border-b border-line px-3 font-semibold",
                        ["Size", "% of database", "7-day change"].includes(h) &&
                          "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-[#f5f8fa]">
                    <td className="h-11 border-b border-line px-3">
                      <Link
                        href={`/segments/${r.id}`}
                        className="flex items-center gap-2 font-medium text-link hover:underline"
                      >
                        {r.type === "ACTIVE" ? (
                          <Zap className="size-3.5 text-ink-subtle" />
                        ) : (
                          <ListChecks className="size-3.5 text-ink-subtle" />
                        )}
                        {r.name}
                      </Link>
                      {r.description && (
                        <div className="max-w-[420px] truncate pl-5 text-[12px] text-ink-subtle">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td className="border-b border-line px-3 text-ink-muted">
                      {OBJECT_NAMES[r.objectType]}
                    </td>
                    <td className="border-b border-line px-3">
                      <TypePill type={r.type} />
                    </td>
                    <td className="border-b border-line px-3 text-right tabular-nums">
                      {r.size.toLocaleString()}
                    </td>
                    <td className="border-b border-line px-3 text-right tabular-nums text-ink-muted">
                      {r.database
                        ? `${((r.size / r.database) * 100).toFixed(r.size / r.database < 0.1 && r.size ? 1 : 0)}%`
                        : "0%"}
                    </td>
                    <td className="border-b border-line px-3 text-right tabular-nums text-ink-muted">
                      {r.change7d === null
                        ? "--"
                        : `${r.change7d > 0 ? "+" : ""}${r.change7d.toLocaleString()}`}
                    </td>
                    <td className="border-b border-line px-3 text-ink-muted">
                      {r.ownerName ?? "--"}
                    </td>
                    <td className="border-b border-line px-3 text-ink-muted">
                      {formatDate(r.updatedAt)}
                    </td>
                    <td className="w-10 border-b border-line px-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${r.name} actions`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => router.push(`/segments/${r.id}`)}
                          >
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a
                              href={`/api/export/${r.objectType === "CONTACT" ? "contacts" : "companies"}?segment=${r.id}`}
                            >
                              Export CSV
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              start(async () => {
                                const res = await cloneSegment(r.id);
                                if (!res.ok) return setError(res.error);
                                router.push(`/segments/${res.data!.id}`);
                              })
                            }
                          >
                            Clone
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={() => setConfirm(r)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <div className="py-16 text-center">
                <div className="mb-1 text-[16px] font-medium">
                  {rows.length ? "No segments match" : "No segments yet"}
                </div>
                <div className="text-[13px] text-ink-muted">
                  Create one here, or use &ldquo;Create segment from this
                  view&rdquo; on a contacts or companies list.
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <CreateSegmentDialog open={createOpen} onOpenChange={setCreateOpen} />
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title={`Delete ${confirm?.name ?? "segment"}?`}>
          <div className="space-y-4 px-6 py-5 text-[13px]">
            <p>
              The records stay in the CRM. Only the segment and its member list
              are removed. Views and filters that use it will stop matching
              anything.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await deleteSegment(confirm!.id);
                    setConfirm(null);
                    if (!res.ok) return setError(res.error);
                    router.refresh();
                  })
                }
              >
                Delete segment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateSegmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [object, setObject] = useState<CrmObject>("CONTACT");
  const [type, setType] = useState<"ACTIVE" | "STATIC">("ACTIVE");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) {
          setName("");
          setError(null);
        }
      }}
    >
      <DialogContent title="Create segment">
        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createSegment(object, name, type);
              if (!res.ok) return setError(res.error);
              router.push(`/segments/${res.data!.id}`);
            });
          }}
        >
          {error && (
            <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <div>
            <Label htmlFor="seg-name">Segment name</Label>
            <Input
              id="seg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
            />
          </div>
          <fieldset>
            <legend className="mb-1 text-[12px] font-medium">Object</legend>
            <div className="flex gap-2">
              {(["CONTACT", "COMPANY"] as const).map((o) => (
                <Button
                  key={o}
                  type="button"
                  size="sm"
                  variant={object === o ? "outline" : "secondary"}
                  aria-pressed={object === o}
                  onClick={() => setObject(o)}
                >
                  {OBJECT_NAMES[o]}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-[12px] font-medium">Type</legend>
            {(
              [
                [
                  "ACTIVE",
                  "Active",
                  "Filter-based. Records join and leave automatically as they match.",
                ],
                [
                  "STATIC",
                  "Static",
                  "A fixed list. Add records by hand or from a list's bulk actions.",
                ],
              ] as const
            ).map(([v, l, help]) => (
              <label key={v} className="flex cursor-pointer gap-2 py-1">
                <input
                  type="radio"
                  className="mt-0.5 accent-[var(--link)]"
                  checked={type === v}
                  onChange={() => setType(v)}
                />
                <span>
                  <span className="block text-[13px]">{l}</span>
                  <span className="block text-[12px] text-ink-subtle">
                    {help}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !name.trim()}
            >
              {type === "ACTIVE" ? "Next: add filters" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
