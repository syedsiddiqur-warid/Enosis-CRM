"use client";

import { Command } from "cmdk";
import { Bell, Building2, Handshake, Phone, Plus, Search, Settings, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/overlays";
import { formatPhone, initials } from "@/lib/utils";

interface SearchHit {
  type: "contact" | "company" | "deal" | "phone";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const HIT_ICON = { contact: UserRound, company: Building2, deal: Handshake, phone: Phone };
const HIT_GROUP = { contact: "Contacts", company: "Companies", deal: "Deals", phone: "Phone numbers" };

export function TopBar({ user, workspaceName, signOutAction }: { user: { name?: string | null; email?: string | null }; workspaceName: string; signOutAction: () => Promise<void> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: abort.current.signal });
        if (res.ok) setHits(await res.json());
      } catch {}
      setLoading(false);
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  const groups = (Object.keys(HIT_GROUP) as SearchHit["type"][]).map((type) => ({ type, items: hits.filter((h) => h.type === type) })).filter((g) => g.items.length);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 bg-nav px-3 text-nav-text">
      <Link href="/" className="flex items-center gap-2 pr-3 text-[15px] font-semibold text-white">
        <span className="flex size-7 items-center justify-center rounded-[6px] bg-primary text-[13px]">E</span>
        <span className="hidden sm:inline">{workspaceName}</span>
      </Link>

      <div className="relative mx-auto w-full max-w-[520px]">
        <button
          onClick={() => setOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-[4px] bg-white/10 px-3 text-left text-[13px] text-nav-text/80 hover:bg-white/15"
        >
          <Search className="size-4" />
          <span className="flex-1">Find in CRM</span>
          <kbd className="rounded border border-white/20 px-1.5 text-[11px]">Ctrl K</kbd>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <Command shouldFilter={false} className="absolute left-0 right-0 top-0 z-50 overflow-hidden rounded-[4px] border border-line bg-surface text-ink shadow-xl" label="Find in CRM">
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search className="size-4 text-ink-subtle" />
                <Command.Input
                  autoFocus
                  value={q}
                  onValueChange={setQ}
                  onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
                  placeholder="Search contacts, companies, deals, phone numbers"
                  className="h-10 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-subtle"
                />
              </div>
              <Command.List className="thin-scroll max-h-[420px] overflow-y-auto py-1">
                {q.trim().length < 2 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-ink-subtle">Type at least 2 characters</div>
                ) : (
                  <Command.Empty className="px-4 py-6 text-center text-[13px] text-ink-subtle">{loading ? "Searching…" : "No results"}</Command.Empty>
                )}
                {groups.map((g) => (
                  <Command.Group key={g.type} heading={HIT_GROUP[g.type]} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-ink-subtle">
                    {g.items.map((h) => {
                      const Icon = HIT_ICON[h.type];
                      return (
                        <Command.Item
                          key={h.type + h.id}
                          value={h.type + h.id}
                          onSelect={() => go(h.href)}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 data-[selected=true]:bg-surface-hover"
                        >
                          <Icon className="size-4 text-ink-muted" />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium">{h.type === "phone" ? formatPhone(h.title) : h.title}</div>
                            {h.subtitle && <div className="truncate text-[12px] text-ink-subtle">{h.subtitle}</div>}
                          </div>
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip content="AI Assistant (phase 2)">
          <button className="flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-[13px] hover:bg-nav-hover" aria-label="AI Assistant">
            <Sparkles className="size-4" />
          </button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Create">
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Create</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => router.push("/contacts?create=1")}>Contact</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/companies?create=1")}>Company</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/deals")}>Deal</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/tasks")}>Task</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/prospecting")}>Call log</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconLink href="/prospecting" label="Call logger" icon={Phone} />
        <IconLink href="/notifications" label="Notifications" icon={Bell} />
        <IconLink href="/settings" label="Settings" icon={Settings} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex size-8 items-center justify-center rounded-full bg-[#ff7a59] text-[12px] font-semibold text-white" aria-label="Account">
              {initials(user.name ?? user.email)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-3 py-2">
              <div className="text-[13px] font-medium">{user.name}</div>
              <div className="truncate text-[12px] text-ink-subtle">{user.email}</div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings")}>Profile & preferences</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => signOutAction()}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function IconLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Bell }) {
  return (
    <Tooltip content={label}>
      <Link href={href} className="flex size-8 items-center justify-center rounded-[4px] hover:bg-nav-hover" aria-label={label}>
        <Icon className="size-4" />
      </Link>
    </Tooltip>
  );
}
