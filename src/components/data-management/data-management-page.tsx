"use client";

import { FileSpreadsheet, FileUp, KeyRound, Upload, UsersRound } from "lucide-react";
import Link from "next/link";
import { ImportHistoryTable } from "@/components/settings/import-settings";
import { friendlyDateTime } from "@/lib/crm/dates";
import type { BatchRow, ImportJobRow } from "@/lib/crm/import-history";

type Stats = { inResearch: number; addedWeek: number; readiedWeek: number; keys: number };

const ACTIONS = [
  {
    href: "/import?object=companies&research=1",
    icon: Upload,
    title: "Import companies",
    text: "CSV or Excel from lead tools, or a Dynamics export. New companies go to the Research Queue; ones with research or call history go straight to their stage.",
  },
  { href: "/import?object=contacts", icon: UsersRound, title: "Import contacts", text: "People for companies you already have, matched by email. Their companies are linked or created by name or domain." },
  { href: "/settings/api", icon: KeyRound, title: "Intake API", text: "Access keys for Apollo, Clay, Zapier or your own scripts to send companies in automatically." },
  { href: "/settings/import", icon: FileSpreadsheet, title: "Templates", text: "Saved column mappings, so the next export from the same tool maps itself." },
];

export function DataManagementPage({ stats, jobs, batches }: { stats: Stats; jobs: ImportJobRow[]; batches: BatchRow[] }) {
  const tiles: [string, number, string, string?][] = [
    ["In the Research Queue", stats.inResearch, "Hidden from Companies and Contacts until ready", "/research"],
    ["New companies, last 7 days", stats.addedWeek, "From imports, the API and manual entry"],
    ["Made ready, last 7 days", stats.readiedWeek, "Moved to Companies and Handover", "/handover"],
    ["Active API keys", stats.keys, "Tools sending companies in", "/settings/api"],
  ];
  return (
    <div className="thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-6 py-5">
      <h1 className="text-[22px] font-medium">Data Management</h1>
      <p className="mt-1 max-w-[820px] text-[13px] text-ink-muted">
        Bring companies in for the research team. Every company is checked for duplicates by website domain (or by name when there is no website): a match is updated, never added twice.
        New companies stay in the Research Queue, out of Companies and Contacts, until a researcher marks them ready to call.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([label, value, hint, href]) => {
          const body = (
            <>
              <div className="text-[12px] text-ink-muted">{label}</div>
              <div className="mt-1 text-[24px] font-medium tabular-nums">{value.toLocaleString()}</div>
              <div className="text-[12px] text-ink-subtle">{hint}</div>
            </>
          );
          return href ? (
            <Link key={label} href={href} className="rounded-[6px] border border-line p-3 hover:bg-surface-hover">
              {body}
            </Link>
          ) : (
            <div key={label} className="rounded-[6px] border border-line p-3">
              {body}
            </div>
          );
        })}
      </div>

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">Bring data in</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIONS.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="flex flex-col rounded-[6px] border border-line p-4 hover:border-[#00a4bd] hover:bg-surface-hover">
            <Icon className="size-5 text-ink-muted" />
            <div className="mt-2 text-[14px] font-medium">{title}</div>
            <p className="mt-1 text-[12px] text-ink-muted">{text}</p>
          </Link>
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">Batches</h2>
      {batches.length ? (
        <div className="thin-scroll overflow-x-auto rounded-[4px] border border-line">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2 text-right">Companies</th>
                <th className="px-3 py-2 text-right">In research</th>
                <th className="px-3 py-2 text-right">Moved on</th>
                <th className="px-3 py-2">Progress</th>
                <th className="px-3 py-2">Last added</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const pct = b.companies ? Math.round((b.ready / b.companies) * 100) : 0;
                return (
                  <tr key={b.batch} className="border-t border-line">
                    <td className="max-w-[280px] truncate px-3 py-2 font-medium">{b.batch}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.companies.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.inResearch ? (
                        <Link href={`/research?view=list&batch=${encodeURIComponent(b.batch)}`} className="text-link hover:underline">
                          {b.inResearch.toLocaleString()}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.ready.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted">
                          <div className="h-full bg-[#00bda5]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[12px] tabular-nums text-ink-muted">{pct}%</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{friendlyDateTime(b.lastAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-ink-subtle">No batches yet. Every import gets one (the date and file name, unless you name it).</p>
      )}

      <div className="mb-2 mt-6 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Recent imports</h2>
        <Link href="/settings/import" className="ml-auto flex items-center gap-1 text-[13px] text-link hover:underline">
          <FileUp className="size-4" /> All imports and templates
        </Link>
      </div>
      <ImportHistoryTable jobs={jobs} />
    </div>
  );
}
