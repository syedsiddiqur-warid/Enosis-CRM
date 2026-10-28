"use client";

import { Building2, Copy } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/crm/dates";
import type { PropDef, PropOption, UserLite } from "@/lib/crm/types";
import { cn, colorFor, formatNumber, formatPhone, initials } from "@/lib/utils";

export function optionFor(def: PropDef, value: unknown): PropOption | undefined {
  return def.options?.find((o) => o.value === value);
}

export function Pill({ label, color, className }: { label: string; color?: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-line bg-surface-muted px-2 py-[1px] text-[12px]", className)}>
      {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function UserAvatar({ user, size = 22 }: { user: UserLite | undefined; size?: number }) {
  const name = user?.name ?? user?.email ?? "";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(user?.id ?? "x") }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function CompanyLogo({ name, domain, size = 22 }: { name: string; domain?: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] text-[11px] font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(domain ?? name) }}
      aria-hidden
    >
      {name ? name[0].toUpperCase() : <Building2 className="size-3" />}
    </span>
  );
}

export function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

/** Read-only rendering of a property value, used by table cells, preview and board cards. */
export function PropValue({ def, value, users }: { def: PropDef; value: unknown; users: UserLite[] }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    return <span className="text-ink-subtle">--</span>;
  }
  switch (def.type) {
    case "USER": {
      const u = users.find((x) => x.id === value);
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <UserAvatar user={u} />
          <span className="truncate">{u?.name ?? u?.email ?? "Unknown user"}</span>
        </span>
      );
    }
    case "ENUM":
    case "RADIO": {
      const o = optionFor(def, value);
      return def.name === "lifecycleStage" || def.name === "leadState" || o?.color ? <Pill label={o?.label ?? String(value)} color={o?.color} /> : <span className="truncate">{o?.label ?? String(value)}</span>;
    }
    case "MULTI_ENUM":
      return (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {(value as string[]).map((v) => (
            <Pill key={v} label={optionFor(def, v)?.label ?? v} />
          ))}
        </span>
      );
    case "DATE":
      return <span className="truncate">{formatDate(String(value))}</span>;
    case "DATETIME":
      return <span className="truncate">{formatDateTime(String(value))}</span>;
    case "NUMBER":
      return <span className="tabular-nums">{formatNumber(value, def.format)}</span>;
    case "BOOLEAN":
      return <span>{value ? "Yes" : "No"}</span>;
    case "PHONE":
      return <span className="truncate tabular-nums">{formatPhone(String(value))}</span>;
    case "EMAIL":
      return (
        <span className="group/copy inline-flex min-w-0 items-center gap-1">
          <a href={`mailto:${value}`} className="truncate text-link hover:underline" onClick={(e) => e.stopPropagation()}>
            {String(value)}
          </a>
          <button
            className="invisible shrink-0 text-ink-subtle hover:text-ink group-hover/copy:visible"
            onClick={(e) => {
              e.stopPropagation();
              copyText(String(value));
            }}
            aria-label="Copy email"
          >
            <Copy className="size-3.5" />
          </button>
        </span>
      );
    case "URL": {
      const href = /^https?:\/\//.test(String(value)) ? String(value) : `https://${value}`;
      return (
        <a href={href} target="_blank" rel="noreferrer" className="truncate text-link hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, "")}
        </a>
      );
    }
    default:
      return <span className="truncate">{String(value)}</span>;
  }
}
