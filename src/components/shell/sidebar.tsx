"use client";

import {
  ArrowRightLeft,
  BarChart3,
  Building2,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  Home,
  ListFilter,
  Megaphone,
  PhoneCall,
  Settings,
  Target,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { items: [{ href: "/", label: "Home", icon: Home }] },
  {
    title: "CRM",
    items: [
      { href: "/contacts", label: "Contacts", icon: UserRound },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/leads", label: "Leads", icon: UsersRound },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/segments", label: "Segments", icon: ListFilter },
    ],
  },
  {
    title: "Sales",
    items: [
      // In the order work flows: research → handover → campaigns → calling → follow-up
      { href: "/research", label: "Research Queue", icon: FlaskConical },
      { href: "/handover", label: "Handover", icon: ArrowRightLeft },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/prospecting", label: "Prospecting", icon: PhoneCall },
      { href: "/follow-ups", label: "Follow-ups", icon: Target },
    ],
  },
  { title: "Reports", items: [{ href: "/dashboards", label: "Dashboards", icon: BarChart3 }] },
  { items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("crm.sidebar") === "collapsed");
    } catch {}
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem("crm.sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  }

  return (
    <nav className={cn("flex shrink-0 flex-col bg-nav text-nav-text transition-[width] duration-150", collapsed ? "w-14" : "w-[216px]")} aria-label="Main">
      <div className="thin-scroll flex-1 overflow-y-auto py-2">
        {SECTIONS.map((section, i) => (
          <div key={i} className={cn(i > 0 && "mt-2 border-t border-white/10 pt-2")}>
            {section.title && !collapsed && (
              <div className="px-4 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-nav-text/60">{section.title}</div>
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              const link = (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "mx-2 flex h-9 items-center gap-3 rounded-[4px] px-2.5 text-[13.5px] hover:bg-nav-hover",
                    active && "bg-nav-active font-medium text-white",
                    collapsed && "justify-center px-0",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={href} content={label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        ))}
      </div>
      <button
        onClick={toggle}
        className="flex h-10 items-center gap-3 border-t border-white/10 px-4 text-[13px] text-nav-text/80 hover:bg-nav-hover"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        {!collapsed && "Collapse"}
      </button>
    </nav>
  );
}
