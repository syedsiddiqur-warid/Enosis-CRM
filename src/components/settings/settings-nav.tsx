"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const SECTIONS: { title: string; items: { href: string; label: string; later?: string }[] }[] = [
  {
    title: "Account",
    items: [
      { href: "/settings/general", label: "General" },
      { href: "/settings/users", label: "Users & teams" },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/settings/properties", label: "Properties" },
      { href: "/settings/lists", label: "Dropdown lists & follow-ups" },
      { href: "/settings/import", label: "Import & templates" },
      { href: "/settings/integrations", label: "Integrations" },
    ],
  },
  {
    title: "Customization",
    items: [
      { href: "#layouts", label: "Record layouts", later: "Record layout editor: build step 11" },
      { href: "#pipelines", label: "Pipelines", later: "Deal pipelines: build step 7" },
      { href: "#permissions", label: "Roles & permissions", later: "Permission sets: build step 11" },
      { href: "#automation", label: "Automation rules", later: "Workflow rule builder: build step 11" },
      { href: "#branding", label: "Branding", later: "Logo and colors: build step 11" },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="thin-scroll w-[220px] shrink-0 overflow-y-auto rounded-[6px] border border-line bg-surface py-3">
      <div className="px-4 pb-2 text-[16px] font-medium">Settings</div>
      {SECTIONS.map((s) => (
        <div key={s.title} className="mt-2">
          <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{s.title}</div>
          {s.items.map((i) =>
            i.later ? (
              <Tooltip key={i.href} content={i.later} side="right">
                <span className="block cursor-default px-4 py-1.5 text-[13px] text-ink-subtle">{i.label}</span>
              </Tooltip>
            ) : (
              <Link
                key={i.href}
                href={i.href}
                aria-current={pathname.startsWith(i.href) ? "page" : undefined}
                className={cn("block px-4 py-1.5 text-[13px] hover:bg-surface-hover", pathname.startsWith(i.href) && "bg-[#e5f5f8] font-medium shadow-[inset_3px_0_0_var(--link)]")}
              >
                {i.label}
              </Link>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
