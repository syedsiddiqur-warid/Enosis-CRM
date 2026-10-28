"use client";

import { ChevronDown, Lock, Pin, Plus, Search, Star, Users, X } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui/button";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@/components/ui/overlays";
import type { ViewSummary } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { ViewNameDialog } from "./dialogs";

type Visibility = ViewSummary["visibility"];

export interface ViewTabActions {
  select: (id: string) => void;
  create: (name: string, visibility: Visibility, teamId: string | null) => Promise<string | null>;
  rename: (id: string, name: string, visibility: Visibility, teamId: string | null) => Promise<string | null>;
  clone: (id: string) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  setOpen: (id: string, open: boolean) => void;
  setDefault: (id: string | null) => void;
  pin: (id: string, pinned: boolean) => void;
}

const MAX_TABS = 8;

function sharingLabel(v: ViewSummary) {
  if (v.systemKey) return "Default view";
  if (v.visibility === "PRIVATE") return "Private";
  if (v.visibility === "TEAM") return v.teamName ? `Team: ${v.teamName}` : "Team";
  return "Everyone";
}

function VisibilityIcon({ v }: { v: ViewSummary }) {
  if (v.isPinned) return <Pin className="size-3 shrink-0 opacity-60" aria-label="Pinned by an admin" />;
  if (v.systemKey) return null;
  if (v.visibility === "PRIVATE") return <Lock className="size-3 shrink-0 opacity-60" aria-label="Private view" />;
  if (v.visibility === "TEAM") return <Users className="size-3 shrink-0 opacity-60" aria-label="Team view" />;
  return null;
}

export function ViewTabs({
  views,
  activeId,
  isAdmin,
  teams,
  actions,
}: {
  views: ViewSummary[];
  activeId: string;
  isAdmin: boolean;
  teams: { id: string; name: string }[];
  actions: ViewTabActions;
}) {
  const [dialog, setDialog] = useState<null | { mode: "create" } | { mode: "rename"; view: ViewSummary }>(null);
  const [allOpen, setAllOpen] = useState(false);
  // HubSpot keeps a handful of tabs open; everything else is reachable from "All views"
  const open = views.filter((v) => v.isOpen || v.id === activeId);
  const tabs = open.slice(0, MAX_TABS);
  const active = open.find((v) => v.id === activeId);
  if (active && !tabs.includes(active)) tabs[MAX_TABS - 1] = active;
  const hasDefault = views.some((v) => v.isDefault);

  return (
    <div className="flex items-end gap-1 border-b border-line px-6">
      {tabs.map((v) => {
        const isActive = v.id === activeId;
        const canEdit = v.systemKey ? isAdmin : v.isOwn;
        const closable = !v.systemKey && !v.isPinned;
        const isDefault = v.isDefault || (!hasDefault && v.systemKey === "all");
        return (
          <div
            key={v.id}
            className={cn(
              "group relative flex h-10 max-w-[240px] items-center rounded-t-[4px] border border-b-0 text-[13px]",
              isActive ? "-mb-px border-line bg-surface font-medium text-ink" : "border-transparent text-ink-muted hover:bg-surface-hover",
            )}
          >
            <button className="flex min-w-0 items-center gap-1.5 px-3" onClick={() => actions.select(v.id)} title={`${v.name} · ${sharingLabel(v)}${v.ownerName && !v.systemKey ? ` · by ${v.ownerName}` : ""}`}>
              <VisibilityIcon v={v} />
              <span className="truncate">{v.name}</span>
              {v.isDefault && <Star className="size-3 shrink-0 fill-current opacity-60" aria-label="Your default view" />}
            </button>
            {isActive && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="mr-1 rounded p-0.5 hover:bg-surface-hover" aria-label={`${v.name} view options`}>
                    <ChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem disabled={!canEdit} onSelect={() => setDialog({ mode: "rename", view: v })}>
                    {v.systemKey ? "Rename" : "Rename & sharing"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.clone(v.id)}>Clone</DropdownMenuItem>
                  <DropdownMenuItem disabled={isDefault} onSelect={() => actions.setDefault(v.systemKey === "all" ? null : v.id)}>
                    {isDefault ? "Your default view" : "Set as my default"}
                  </DropdownMenuItem>
                  {isAdmin && !v.systemKey && (
                    <DropdownMenuItem disabled={v.visibility === "PRIVATE"} onSelect={() => actions.pin(v.id, !v.isPinned)}>
                      {v.isPinned ? "Unpin" : v.visibility === "PRIVATE" ? "Pin (share it first)" : v.visibility === "TEAM" ? "Pin for the team" : "Pin for everyone"}
                    </DropdownMenuItem>
                  )}
                  {!v.systemKey && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={!canEdit} onSelect={() => actions.move(v.id, -1)}>
                        Move left
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!canEdit} onSelect={() => actions.move(v.id, 1)}>
                        Move right
                      </DropdownMenuItem>
                      {closable && <DropdownMenuItem onSelect={() => actions.setOpen(v.id, false)}>Close tab</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive disabled={!canEdit} onSelect={() => actions.remove(v.id)}>
                        Delete view
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {closable && !isActive && (
              <button
                onClick={() => actions.setOpen(v.id, false)}
                className="invisible mr-1 rounded p-0.5 hover:bg-black/5 group-hover:visible"
                aria-label={`Close ${v.name} tab`}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
      <Tooltip content="Add view">
        <button
          onClick={() => setDialog({ mode: "create" })}
          className="mb-1 flex size-8 items-center justify-center rounded-[4px] text-ink-muted hover:bg-surface-hover"
          aria-label="Add view"
        >
          <Plus className="size-4" />
        </button>
      </Tooltip>
      <button onClick={() => setAllOpen(true)} className="mb-1 flex h-8 items-center gap-1 rounded px-2 text-[13px] text-link hover:bg-surface-hover">
        All views ({views.length})
      </button>

      <ViewNameDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.mode === "rename" ? "Rename view" : "Create new view"}
        initialName={dialog?.mode === "rename" ? dialog.view.name : ""}
        initialVisibility={dialog?.mode === "rename" ? dialog.view.visibility : "PRIVATE"}
        initialTeamId={dialog?.mode === "rename" ? dialog.view.teamId : null}
        teams={teams}
        showVisibility={dialog?.mode !== "rename" || !dialog.view.systemKey}
        onSubmit={(name, vis, teamId) => (dialog?.mode === "rename" ? actions.rename(dialog.view.id, name, vis, teamId) : actions.create(name, vis, teamId))}
      />
      <AllViewsDialog open={allOpen} onOpenChange={setAllOpen} views={views} activeId={activeId} isAdmin={isAdmin} actions={actions} />
    </div>
  );
}

function AllViewsDialog({
  open,
  onOpenChange,
  views,
  activeId,
  isAdmin,
  actions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  views: ViewSummary[];
  activeId: string;
  isAdmin: boolean;
  actions: ViewTabActions;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "mine" | "shared">("all");
  const shown = views.filter(
    (v) =>
      v.name.toLowerCase().includes(q.trim().toLowerCase()) &&
      (filter === "all" || (filter === "mine" ? v.isOwn && !v.systemKey : !v.systemKey && v.visibility !== "PRIVATE")),
  );
  const ownCount = views.filter((v) => v.isOwn && !v.systemKey).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="All views" className="w-[760px] max-w-[calc(100vw-32px)]">
        <div className="space-y-3 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[240px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search views" className="pl-8" aria-label="Search views" autoFocus />
            </div>
            {(
              [
                ["all", "All"],
                ["mine", "Created by me"],
                ["shared", "Shared"],
              ] as const
            ).map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? "outline" : "ghost"} onClick={() => setFilter(k)} aria-pressed={filter === k}>
                {l}
              </Button>
            ))}
            <span className="ml-auto text-[12px] text-ink-subtle">{ownCount} of 50 views used</span>
          </div>
          <div className="thin-scroll max-h-[420px] overflow-y-auto rounded-[4px] border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface-muted text-left text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Shared with</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <button
                        className="flex items-center gap-1.5 text-left font-medium text-link hover:underline"
                        onClick={() => {
                          if (!v.isOpen) actions.setOpen(v.id, true);
                          actions.select(v.id);
                          onOpenChange(false);
                        }}
                      >
                        <VisibilityIcon v={v} />
                        {v.name}
                        {v.isDefault && <Star className="size-3 fill-current text-ink-subtle" aria-label="Your default view" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{v.systemKey ? "System" : (v.ownerName ?? "--")}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {sharingLabel(v)}
                      {v.isPinned && " · pinned"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {!v.systemKey && !v.isPinned && (
                          <Button size="sm" variant="ghost" onClick={() => actions.setOpen(v.id, !v.isOpen)}>
                            {v.isOpen ? "Close tab" : "Open tab"}
                          </Button>
                        )}
                        {!v.isDefault && v.systemKey !== "all" && (
                          <Button size="sm" variant="ghost" onClick={() => actions.setDefault(v.id)}>
                            Make default
                          </Button>
                        )}
                        {isAdmin && !v.systemKey && v.visibility !== "PRIVATE" && (
                          <Button size="sm" variant="ghost" onClick={() => actions.pin(v.id, !v.isPinned)}>
                            {v.isPinned ? "Unpin" : "Pin"}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => actions.clone(v.id)}>
                          Clone
                        </Button>
                        {v.isOwn && !v.systemKey && v.id !== activeId && (
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => actions.remove(v.id)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-ink-subtle">
                      No views match
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
