"use client";

import { CalendarDays, ChevronDown, ChevronRight, Info, Mail, NotebookPen, Pencil, Phone, Settings2, SquareCheckBig, Zap } from "lucide-react";
import { useState } from "react";
import { CellEditor } from "@/components/index/cell-editor";
import { PropValue } from "@/components/index/values";
import { Popover, PopoverAnchor, PopoverContent, Tooltip } from "@/components/ui/overlays";
import type { RecordActivity } from "@/lib/crm/record-types";
import type { PropDef } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { useRecord } from "./record-context";

/** Collapsible card used in the left and right columns; collapse state is remembered per user. */
export function RecordCard({
  id,
  title,
  count,
  actions,
  children,
  className,
  bodyClassName,
}: {
  id: string;
  title: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const { isCollapsed, toggleCard } = useRecord();
  const collapsed = isCollapsed(id);
  return (
    <section className={cn("border-b border-line last:border-b-0", className)}>
      <div className="flex min-h-11 items-center gap-1 px-4">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 py-2.5 text-left text-[14px] font-semibold"
          onClick={() => toggleCard(id)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="size-4 shrink-0 text-ink-muted" /> : <ChevronDown className="size-4 shrink-0 text-ink-muted" />}
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-normal text-ink-subtle">({count})</span>}
        </button>
        {!collapsed && actions}
      </div>
      {!collapsed && <div className={cn("px-4 pb-4", bodyClassName)}>{children}</div>}
    </section>
  );
}

export function CardGear({ label, step = 11 }: { label: string; step?: number }) {
  return (
    <Tooltip content={`${label} – customization arrives in build step ${step}`}>
      <span className="flex size-7 items-center justify-center rounded text-ink-subtle" aria-label={label}>
        <Settings2 className="size-4" />
      </span>
    </Tooltip>
  );
}

/** Whether a dependent property should show, given the record's current values. */
export function isShown(def: PropDef, values: Record<string, unknown>) {
  if (!def.showWhen) return true;
  return def.showWhen.in.includes(String(values[def.showWhen.property] ?? ""));
}

/** A label/value pair that edits inline, HubSpot style. */
export function PropertyRow({ def, value, compact }: { def: PropDef; value: unknown; compact?: boolean }) {
  const { data, editProperty } = useRecord();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = !def.isReadOnly && !def.isVirtual;

  async function save(v: unknown) {
    setEditing(false);
    const err = await editProperty(def.name, v);
    setError(err);
    if (err) setTimeout(() => setError(null), 5000);
  }

  const display = <PropValue def={def} value={value} users={data.users} />;
  return (
    <div className={cn("group", compact ? "py-1" : "py-1.5")}>
      <div className="flex items-center gap-1 text-[12px] text-ink-muted">
        <span className="truncate">{def.label}</span>
        {def.description && (
          <Tooltip content={def.description}>
            <Info className="size-3 shrink-0 text-ink-subtle" aria-label={def.description} />
          </Tooltip>
        )}
      </div>
      {editable ? (
        <Popover open={editing} onOpenChange={setEditing}>
          <PopoverAnchor asChild>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setEditing(true)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
              className={cn(
                "-mx-1.5 flex min-h-7 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-[3px] px-1.5 text-[13px] hover:bg-surface-hover",
                error && "ring-1 ring-danger",
              )}
              title={error ?? `Edit ${def.label}`}
            >
              <span className="flex min-w-0 items-center">{display}</span>
              <Pencil className="invisible size-3.5 shrink-0 text-ink-subtle group-hover:visible" />
            </div>
          </PopoverAnchor>
          {editing && (
            <PopoverContent onOpenAutoFocus={(e) => e.preventDefault()}>
              <CellEditor def={def} value={value} users={data.users} onSave={save} onCancel={() => setEditing(false)} />
            </PopoverContent>
          )}
        </Popover>
      ) : (
        <div className="flex min-h-7 min-w-0 items-center text-[13px]">{display}</div>
      )}
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}

const ACTIVITY_ICONS = {
  NOTE: { icon: NotebookPen, color: "#f5c26b", label: "Note" },
  EMAIL: { icon: Mail, color: "#6a78d1", label: "Email" },
  CALL: { icon: Phone, color: "#00bda5", label: "Call" },
  TASK: { icon: SquareCheckBig, color: "#00a4bd", label: "Task" },
  MEETING: { icon: CalendarDays, color: "#e3459b", label: "Meeting" },
  SYSTEM: { icon: Zap, color: "#7c98b6", label: "Update" },
} as const;

export function activityMeta(type: RecordActivity["type"]) {
  return ACTIVITY_ICONS[type];
}

export function ActivityIcon({ type, size = 28 }: { type: RecordActivity["type"]; size?: number }) {
  const { icon: Icon, color } = ACTIVITY_ICONS[type];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full border border-line bg-surface" style={{ width: size, height: size }} aria-hidden>
      <Icon className="size-3.5" style={{ color }} />
    </span>
  );
}
