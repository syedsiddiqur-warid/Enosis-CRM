"use client";

import { Download, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pill } from "@/components/index/values";
import { Button } from "@/components/ui/button";
import { friendlyDateTime } from "@/lib/crm/dates";
import { deleteImportTemplate } from "@/lib/crm/import-actions";
import { SettingsPage, SettingsSection } from "./settings-ui";

type Template = { id: string; name: string; object: "CONTACT" | "COMPANY"; mapped: number; columns: number; createdAt: string };
type Job = {
  id: string;
  object: "CONTACT" | "COMPANY";
  fileName: string;
  status: string;
  by: string | null;
  at: string;
  totalRows: number | null;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  segmentId: string | null;
};

const STATUS: Record<string, [string, string]> = {
  completed: ["Completed", "#00bda5"],
  running: ["Running or interrupted", "#f5c26b"],
  cancelled: ["Stopped", "#cbd6e2"],
  failed: ["Failed", "#f2545b"],
};
const plural = (o: "CONTACT" | "COMPANY") => (o === "CONTACT" ? "contacts" : "companies");

export function ImportSettings({ templates, jobs }: { templates: Template[]; jobs: Job[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <SettingsPage
      title="Import & templates"
      description="Bring contacts and companies in from Excel or CSV (Dynamics exports, Seamless.AI, Apollo, Sales Navigator, Lusha, ZoomInfo or your own sheets). Saved mapping templates remember which column goes where."
      actions={
        <div className="flex gap-2">
          <Button variant="primary" asChild>
            <Link href="/import?object=contacts">
              <Upload /> Import contacts
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/import?object=companies">
              <Upload /> Import companies
            </Link>
          </Button>
        </div>
      }
    >
      {error && <p className="mb-3 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      <SettingsSection title="Blank templates" description="Headers match property names, so these map automatically. Fill one row per record; leave unknown cells empty.">
        <div className="grid max-w-[900px] gap-3 md:grid-cols-2">
          {(["contacts", "companies"] as const).map((o) => (
            <div key={o} className="rounded-[4px] border border-line p-3 text-[13px]">
              <div className="mb-1.5 font-medium capitalize">{o}</div>
              <div className="flex flex-col gap-1">
                <a href={`/api/import/template?object=${o}&kind=template`} className="flex items-center gap-1.5 text-link hover:underline">
                  <Download className="size-4" /> Common columns (.csv)
                </a>
                <a href={`/api/import/template?object=${o}&kind=full`} className="flex items-center gap-1.5 text-link hover:underline">
                  <Download className="size-4" /> Every importable column (.csv)
                </a>
                <a href={`/api/import/template?object=${o}&kind=values`} className="flex items-center gap-1.5 text-link hover:underline">
                  <Download className="size-4" /> Format and allowed values (.csv)
                </a>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={`Saved mapping templates (${templates.length})`} description="Create one on the import's mapping step with “Save this mapping as a template”, then pick it when you upload the next file with the same columns.">
        {templates.length ? (
          <table className="w-full max-w-[900px] text-[13px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="py-1.5">Template</th>
                <th>Object</th>
                <th>Columns mapped</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="py-1.5 font-medium">{t.name}</td>
                  <td className="capitalize text-ink-muted">{plural(t.object)}</td>
                  <td className="text-ink-muted">
                    {t.mapped} of {t.columns}
                  </td>
                  <td className="text-ink-muted">{friendlyDateTime(t.createdAt)}</td>
                  <td className="text-right">
                    <Link href={`/import?object=${plural(t.object)}`} className="mr-2 text-link hover:underline">
                      Use
                    </Link>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Delete template ${t.name}`}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const res = await deleteImportTemplate(t.id);
                          if (!res.ok) return setError(res.error);
                          router.refresh();
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-ink-subtle">No saved templates yet.</p>
        )}
      </SettingsSection>

      <SettingsSection title="Import history">
        {jobs.length ? (
          <div className="thin-scroll overflow-x-auto rounded-[4px] border border-line">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">Created</th>
                  <th className="px-3 py-2 text-right">Updated</th>
                  <th className="px-3 py-2 text-right">Skipped</th>
                  <th className="px-3 py-2 text-right">Errors</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-line">
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="truncate font-medium">{j.fileName}</div>
                      <div className="text-[12px] capitalize text-ink-subtle">
                        {plural(j.object)} · {friendlyDateTime(j.at)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Pill label={STATUS[j.status]?.[0] ?? j.status} color={STATUS[j.status]?.[1]} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.totalRows ?? "--"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.created}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.updated}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.skipped}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${j.errors ? "text-danger" : ""}`}>{j.errors}</td>
                    <td className="px-3 py-2 text-ink-muted">{j.by ?? "--"}</td>
                    <td className="px-3 py-2 text-right">
                      {j.segmentId && (
                        <Link href={`/segments/${j.segmentId}`} className="text-link hover:underline">
                          View records
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ink-subtle">No imports yet.</p>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
