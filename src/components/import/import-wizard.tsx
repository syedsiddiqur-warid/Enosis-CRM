"use client";

import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { looksLikeCallerNotes, looksLikeDescription, parseDynamics } from "@/lib/crm/dynamics-parser";
import { finishImport, importChunk, saveImportTemplate, startImport, validateImport, type ImportRow, type ImportSetup } from "@/lib/crm/import-actions";
import { DYN_CALLER_NOTES, DYN_DESCRIPTION, suggestTarget, type ImportObject, type ImportOptions, type ImportRowResult, type ImportTargetOption } from "@/lib/crm/import-shared";
import type { PropOption, UserLite } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { DynamicsReview, type ReviewItem } from "./dynamics-review";

const MAX_ROWS = 20000;
const VALIDATE_CHUNK = 100;
// Small batches keep each request well inside serverless time limits (Netlify functions: ~10 s)
const IMPORT_CHUNK = 50;

type Step = "upload" | "map" | "review" | "running" | "done";
interface Sheet {
  fileName: string;
  headers: string[];
  rows: ImportRow[];
}
interface Tally {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  failed: ImportRowResult[];
  addedOptions: { property: string; value: string }[];
  /** Rows whose Description / Caller Notes added contacts, numbers, calls or notes */
  dynamics: number;
}
const emptyTally = (): Tally => ({ created: 0, updated: 0, skipped: 0, errors: 0, failed: [], addedOptions: [], dynamics: 0 });

/** Minimal RFC 4180 CSV parser: quotes, escaped quotes, CRLF, BOM; comma, semicolon or tab delimited. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") >= 0 ? src.indexOf("\n") : src.length);
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return s.trim() === "" ? null : s;
}

async function readFile(file: File): Promise<Sheet> {
  let grid: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    grid = (await readSheet(file)) as unknown[][];
  } else if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    grid = parseCsv(await file.text());
  } else {
    throw new Error("Upload a .csv or .xlsx file. For .xls, open it in Excel and save as .xlsx or CSV UTF-8.");
  }
  const nonEmpty = (r: unknown[]) => r.some((c) => cellText(c) !== null);
  const headerIndex = grid.findIndex(nonEmpty);
  if (headerIndex < 0) throw new Error("The file is empty");
  const headers = grid[headerIndex].map((h, i) => cellText(h)?.trim() || `Column ${i + 1}`);
  const rows: ImportRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    if (!nonEmpty(grid[i])) continue;
    rows.push({ row: i + 1, cells: headers.map((_, c) => cellText(grid[i][c])) });
  }
  if (!rows.length) throw new Error("The file has a header row but no data rows");
  if (rows.length > MAX_ROWS) throw new Error(`Split the file: up to ${MAX_ROWS.toLocaleString()} rows per import (this one has ${rows.length.toLocaleString()})`);
  return { fileName: file.name, headers, rows };
}

function csvCell(v: string | null) {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ImportWizard({
  object,
  targets,
  users,
  currentUserId,
  leadSources,
  templates,
  callOutcomes,
}: {
  object: ImportObject;
  targets: ImportTargetOption[];
  users: UserLite[];
  currentUserId: string;
  leadSources: PropOption[];
  templates: { id: string; name: string; mapping: Record<string, string> }[];
  /** Call outcome values the Caller Notes parser maps results to */
  callOutcomes: string[];
}) {
  const router = useRouter();
  const plural = object === "CONTACT" ? "contacts" : "companies";
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSaved, setTemplateSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [review, setReview] = useState<Tally | null>(null);
  const [result, setResult] = useState<(Tally & { segmentId: string | null; cancelled: boolean }) | null>(null);
  const cancelRef = useRef(false);
  const [options, setOptions] = useState<ImportOptions>({ mode: "upsert", ownerId: null, source: null, batchNumber: null, addMissingOptions: false, segmentName: "", dynamicsTimeZone: "workspace" });
  const [useSegment, setUseSegment] = useState(true);
  /** Dynamics items unticked on the review screen, per spreadsheet row */
  const [excluded, setExcluded] = useState<Record<number, string[]>>({});

  // What the Dynamics parsers find in each row (same parser the server runs)
  const reviewItems = useMemo<ReviewItem[]>(() => {
    if (!sheet || step === "upload" || step === "map") return [];
    const di = columns.indexOf(DYN_DESCRIPTION);
    const ni = columns.indexOf(DYN_CALLER_NOTES);
    if (di < 0 && ni < 0) return [];
    const col = (t: string) => columns.indexOf(t);
    const labelOf = (cells: (string | null)[]) => {
      const pick = (t: string) => (col(t) >= 0 ? cells[col(t)] : null);
      const person = [pick("prop:firstName"), pick("prop:lastName")].filter(Boolean).join(" ") || pick("prop:email");
      const company = pick("company:name") ?? pick("prop:name") ?? pick("company:domain") ?? pick("prop:domain");
      return [person, company].filter(Boolean).join(" · ") || "(no name)";
    };
    return sheet.rows
      .map((r) => ({ row: r.row, label: labelOf(r.cells), parsed: parseDynamics(di >= 0 ? r.cells[di] : null, ni >= 0 ? r.cells[ni] : null, callOutcomes) }))
      .filter((i) => i.parsed.targets.length + i.parsed.numbers.length + i.parsed.calls.length + i.parsed.notes.length + i.parsed.unparsed.length > 0);
  }, [sheet, columns, step, callOutcomes]);

  const groups = useMemo(() => {
    const m = new Map<string, ImportTargetOption[]>();
    for (const t of targets) m.set(t.group, [...(m.get(t.group) ?? []), t]);
    return [...m.entries()];
  }, [targets]);
  const targetOf = (v: string) => targets.find((t) => t.value === v);

  function applyMapping(headers: string[], tplId: string, rows: ImportRow[]) {
    const tpl = templates.find((t) => t.id === tplId);
    const taken = new Set<string>();
    // Dynamics free-text columns are recognised by their content, whatever the header says
    const sample = (i: number) => rows.slice(0, 200).map((r) => r.cells[i] ?? "");
    const cols = headers.map((h, i) => {
      const fromTpl = tpl ? Object.entries(tpl.mapping).find(([k]) => k.trim().toLowerCase() === h.trim().toLowerCase())?.[1] : undefined;
      let t = fromTpl && (fromTpl === "skip" || targets.some((x) => x.value === fromTpl)) ? fromTpl : null;
      if (!t && !taken.has(DYN_DESCRIPTION) && sample(i).some(looksLikeDescription)) t = DYN_DESCRIPTION;
      if (!t && !taken.has(DYN_CALLER_NOTES) && sample(i).some(looksLikeCallerNotes)) t = DYN_CALLER_NOTES;
      t ??= suggestTarget(h, targets, object, taken);
      if (t !== "skip") taken.add(t);
      return t;
    });
    setColumns(cols);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const s = await readFile(file);
      setSheet(s);
      setExcluded({});
      applyMapping(s.headers, templateId, s.rows);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
      setOptions((o) => ({ ...o, segmentName: `Import – ${file.name.replace(/\.[^.]+$/, "")} – ${today}` }));
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the file");
    } finally {
      setBusy(false);
    }
  }

  const setup = (): ImportSetup => ({
    object,
    fileName: sheet!.fileName,
    headers: sheet!.headers,
    columns,
    options: { ...options, segmentName: useSegment ? options.segmentName : null },
    totalRows: sheet!.rows.length,
  });

  function add(t: Tally, results: ImportRowResult[], added: { property: string; value: string }[]) {
    for (const r of results) {
      if (r.action === "error") {
        t.errors++;
        t.failed.push(r);
      } else {
        t[r.action]++;
        if (r.message?.startsWith("Dynamics:")) t.dynamics++;
      }
    }
    for (const a of added) if (!t.addedOptions.some((x) => x.property === a.property && x.value === a.value)) t.addedOptions.push(a);
  }

  async function validate() {
    setError(null);
    setBusy(true);
    setProgress(0);
    const t = emptyTally();
    try {
      for (let i = 0; i < sheet!.rows.length; i += VALIDATE_CHUNK) {
        const res = await validateImport(setup(), sheet!.rows.slice(i, i + VALIDATE_CHUNK));
        if (!res.ok) throw new Error(res.error);
        add(t, res.data!.results, res.data!.addedOptions);
        setProgress(Math.min(1, (i + VALIDATE_CHUNK) / sheet!.rows.length));
      }
      setReview(t);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setError(null);
    setStep("running");
    setProgress(0);
    cancelRef.current = false;
    const t = emptyTally();
    const start = await startImport(setup());
    if (!start.ok) {
      setError(start.error);
      setStep("review");
      return;
    }
    const { jobId, segmentId } = start.data!;
    let cancelled = false;
    for (let i = 0; i < sheet!.rows.length; i += IMPORT_CHUNK) {
      if (cancelRef.current) {
        cancelled = true;
        break;
      }
      const res = await importChunk(
        jobId,
        sheet!.rows.slice(i, i + IMPORT_CHUNK).map((r) => (excluded[r.row]?.length ? { ...r, exclude: excluded[r.row] } : r)),
      );
      if (!res.ok) {
        // A whole chunk failed (e.g. the server restarted): count its rows as errors and keep going
        add(
          t,
          sheet!.rows.slice(i, i + IMPORT_CHUNK).map((r) => ({ row: r.row, action: "error" as const, message: res.error })),
          [],
        );
      } else add(t, res.data!.results, res.data!.addedOptions);
      setProgress(Math.min(1, (i + IMPORT_CHUNK) / sheet!.rows.length));
    }
    await finishImport(jobId, { created: t.created, updated: t.updated, skipped: t.skipped, errors: t.errors, addedOptions: t.addedOptions.length, cancelled });
    setResult({ ...t, segmentId, cancelled });
    setStep("done");
    router.refresh();
  }

  function downloadErrors(failed: ImportRowResult[]) {
    const byRow = new Map(sheet!.rows.map((r) => [r.row, r]));
    const lines = [[...sheet!.headers, "Row", "Error"].map(csvCell).join(",")];
    for (const f of failed) lines.push([...(byRow.get(f.row)?.cells ?? sheet!.headers.map(() => "")), String(f.row), f.message ?? ""].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet!.fileName.replace(/\.[^.]+$/, "")}-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const mappedCount = columns.filter((c) => c !== "skip").length;
  const dupes = columns.filter((c, i) => c !== "skip" && c !== "phones" && c !== "note" && columns.indexOf(c) !== i);

  return (
    <div className="thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-medium">Import {plural}</h1>
        <div className="flex rounded-[4px] border border-line text-[13px]">
          {(["contacts", "companies"] as const).map((o) => (
            <Link
              key={o}
              href={`/import?object=${o}`}
              aria-current={plural === o ? "page" : undefined}
              className={cn("px-3 py-1.5 capitalize", plural === o ? "bg-[#e5f5f8] font-medium" : "text-ink-muted hover:bg-surface-hover")}
            >
              {o}
            </Link>
          ))}
        </div>
        <ol className="ml-auto flex gap-4 text-[12px] text-ink-subtle">
          {(["upload", "map", "review", "done"] as const).map((s, i) => (
            <li key={s} className={cn((step === s || (s === "done" && step === "running")) && "font-semibold text-ink")}>
              {i + 1}. {s === "upload" ? "Upload" : s === "map" ? "Map columns" : s === "review" ? "Review" : "Import"}
            </li>
          ))}
        </ol>
      </div>
      {error && <p className="mt-3 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      {step === "upload" && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <label
              className={cn("flex cursor-pointer flex-col items-center rounded-[6px] border-2 border-dashed border-line-strong px-6 py-12 text-center hover:border-link", busy && "opacity-60")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files[0]);
              }}
            >
              <Upload className="mb-2 size-8 text-ink-subtle" />
              <span className="text-[15px] font-medium">{busy ? "Reading the file…" : "Drop a file here or click to choose"}</span>
              <span className="mt-1 text-[13px] text-ink-muted">Excel (.xlsx) or CSV, first row = column headers, up to {MAX_ROWS.toLocaleString()} rows</span>
              <input type="file" accept=".csv,.xlsx,.txt,.tsv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy} />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[300px]">
                <Label htmlFor="imp-template">Saved mapping template (optional)</Label>
                <Select id="imp-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Match columns automatically</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="pb-2 text-[12px] text-ink-subtle">A template remembers which of your file&apos;s columns go to which property, e.g. for a recurring Seamless.AI or Dynamics export.</p>
            </div>
          </div>
          <FormatGuide object={object} plural={plural} />
        </div>
      )}

      {step === "map" && sheet && (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <FileSpreadsheet className="size-4 text-ink-muted" />
            <span className="font-medium">{sheet.fileName}</span>
            <span className="text-ink-muted">
              {sheet.rows.length.toLocaleString()} rows · {sheet.headers.length} columns · {mappedCount} mapped
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => (setStep("upload"), setSheet(null))}>
              <ArrowLeft /> Choose another file
            </Button>
          </div>

          <div className="thin-scroll overflow-x-auto rounded-[4px] border border-line">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">Column in your file</th>
                  <th className="px-3 py-2">Sample values</th>
                  <th className="w-[340px] px-3 py-2">Import into</th>
                </tr>
              </thead>
              <tbody>
                {sheet.headers.map((h, i) => {
                  const samples = sheet.rows
                    .map((r) => r.cells[i])
                    .filter(Boolean)
                    .slice(0, 3);
                  const t = targetOf(columns[i]);
                  const dupe = dupes.includes(columns[i]);
                  return (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="max-w-[320px] px-3 py-2 text-ink-muted">
                        {samples.map((s, j) => (
                          <div key={j} className="truncate">
                            {s}
                          </div>
                        ))}
                        {!samples.length && <span className="text-ink-subtle">(empty)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={columns[i]}
                          onChange={(e) => setColumns(columns.map((c, j) => (j === i ? e.target.value : c)))}
                          aria-label={`Import ${h} into`}
                          className={cn(columns[i] === "skip" && "text-ink-subtle", dupe && "border-danger")}
                        >
                          <option value="skip">Don&apos;t import</option>
                          {groups.map(([g, list]) => (
                            <optgroup key={g} label={g}>
                              {list.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                        {t?.hint && <div className="mt-1 line-clamp-2 text-[11px] text-ink-subtle">{t.hint}</div>}
                        {dupe && <div className="mt-1 text-[11px] text-danger">Another column already goes here</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3 rounded-[4px] border border-line p-4 text-[13px]">
              <h2 className="text-[14px] font-semibold">How to import</h2>
              <fieldset>
                <legend className="mb-1 text-[12px] font-medium">
                  Existing records (matched by {object === "CONTACT" ? "email" : "domain, or exact name when there's no domain"})
                </legend>
                {(
                  [
                    ["upsert", "Create new and update existing"],
                    ["create", "Create new only (skip existing)"],
                    ["update", "Update existing only"],
                  ] as const
                ).map(([v, l]) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2 py-0.5">
                    <input type="radio" className="accent-[var(--link)]" checked={options.mode === v} onChange={() => setOptions({ ...options, mode: v })} />
                    {l}
                  </label>
                ))}
                <p className="mt-1 text-[12px] text-ink-subtle">Updates only change the columns you mapped; empty cells never erase existing values.</p>
              </fieldset>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-[var(--link)]" checked={options.addMissingOptions} onChange={(e) => setOptions({ ...options, addMissingOptions: e.target.checked })} />
                <span>
                  Add dropdown values that don&apos;t exist yet
                  <span className="block text-[12px] text-ink-subtle">Otherwise rows with unknown values (e.g. a new industry) are reported as errors.</span>
                </span>
              </label>
            </section>
            <section className="space-y-3 rounded-[4px] border border-line p-4 text-[13px]">
              <h2 className="text-[14px] font-semibold">Defaults for new records</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="imp-owner">Owner (when the file has none)</Label>
                  <Select id="imp-owner" value={options.ownerId ?? ""} onChange={(e) => setOptions({ ...options, ownerId: e.target.value || null })}>
                    <option value="">No owner</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                        {u.id === currentUserId ? " (me)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="imp-source">Lead source {object === "CONTACT" ? "(new companies)" : ""}</Label>
                  <Select id="imp-source" value={options.source ?? ""} onChange={(e) => setOptions({ ...options, source: e.target.value || null })}>
                    <option value="">--</option>
                    {leadSources.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="imp-batch">Batch number {object === "CONTACT" ? "(new companies)" : ""}</Label>
                  <Input id="imp-batch" value={options.batchNumber ?? ""} onChange={(e) => setOptions({ ...options, batchNumber: e.target.value || null })} placeholder="e.g. B-18" maxLength={40} />
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-[var(--link)]" checked={useSegment} onChange={(e) => setUseSegment(e.target.checked)} />
                <span className="min-w-0 flex-1">
                  Put imported records in a new static segment
                  <Input className="mt-1" value={options.segmentName ?? ""} disabled={!useSegment} onChange={(e) => setOptions({ ...options, segmentName: e.target.value })} aria-label="Segment name" maxLength={100} />
                </span>
              </label>
            </section>
          </div>

          <section className="flex flex-wrap items-end gap-2 rounded-[4px] border border-line p-4 text-[13px]">
            <div className="w-[300px]">
              <Label htmlFor="tpl-name">Save this mapping as a template</Label>
              <Input id="tpl-name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Seamless.AI contacts export" maxLength={100} />
            </div>
            <Button
              variant="secondary"
              disabled={!templateName.trim()}
              onClick={async () => {
                const mapping = Object.fromEntries(sheet.headers.map((h, i) => [h, columns[i]]));
                const res = await saveImportTemplate(object, templateName, mapping);
                if (!res.ok) return setError(res.error);
                setTemplateSaved(templateName.trim());
                setTemplateName("");
                router.refresh();
              }}
            >
              Save template
            </Button>
            {templateSaved && (
              <span className="flex items-center gap-1 pb-2 text-[#00a38d]">
                <CheckCircle2 className="size-4" /> Saved &ldquo;{templateSaved}&rdquo;
              </span>
            )}
          </section>

          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={busy || !mappedCount || dupes.length > 0} onClick={() => void validate()}>
              {busy ? `Checking… ${Math.round(progress * 100)}%` : "Next: check the data"}
            </Button>
            <span className="text-[12px] text-ink-subtle">Nothing is saved until you confirm on the next step.</span>
          </div>
        </div>
      )}

      {step === "review" && review && sheet && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ["Will be created", review.created, "#00bda5"],
                ["Will be updated", review.updated, "#00a4bd"],
                ["Skipped", review.skipped, "#cbd6e2"],
                ["Errors (not imported)", review.errors, "#f2545b"],
              ] as const
            ).map(([l, n, c]) => (
              <div key={l} className="rounded-[4px] border border-line px-4 py-3" style={{ borderTop: `3px solid ${c}` }}>
                <div className="text-[22px] font-medium tabular-nums">{n.toLocaleString()}</div>
                <div className="text-[12px] text-ink-muted">{l}</div>
              </div>
            ))}
          </div>
          {review.addedOptions.length > 0 && (
            <p className="rounded-[4px] bg-[#fdf3e1] px-3 py-2 text-[13px]">
              New dropdown values will be added: {review.addedOptions.map((a) => `${a.value} (${a.property})`).join(", ")}
            </p>
          )}
          {review.failed.length > 0 && <ErrorList failed={review.failed} onDownload={() => downloadErrors(review.failed)} />}
          {reviewItems.length > 0 && (
            <DynamicsReview
              items={reviewItems}
              excluded={excluded}
              onChange={setExcluded}
              timeZone={options.dynamicsTimeZone}
              onTimeZone={(tz) => setOptions({ ...options, dynamicsTimeZone: tz })}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={() => setStep("map")}>
              <ArrowLeft /> Back to mapping
            </Button>
            <Button variant="primary" disabled={!review.created && !review.updated} onClick={() => void run()}>
              Import {(review.created + review.updated).toLocaleString()} {plural}
            </Button>
            {review.errors > 0 && <span className="text-[12px] text-ink-muted">Rows with errors are left out. Fix them in the file and import them again later.</span>}
          </div>
        </div>
      )}

      {step === "running" && (
        <div className="mx-auto mt-16 max-w-md text-center">
          <div className="mb-2 text-[16px] font-medium">Importing {plural}…</div>
          <div className="h-2 rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-[#00a4bd] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="mt-2 text-[13px] text-ink-muted">{Math.round(progress * 100)}%. Keep this tab open.</div>
          <Button className="mt-3" variant="ghost" onClick={() => (cancelRef.current = true)}>
            Stop after this batch
          </Button>
        </div>
      )}

      {step === "done" && result && sheet && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 text-[16px] font-medium">
            <CheckCircle2 className="size-5 text-[#00a38d]" /> {result.cancelled ? "Import stopped" : "Import finished"}
          </div>
          <p className="text-[13px]">
            {result.created.toLocaleString()} created, {result.updated.toLocaleString()} updated, {result.skipped.toLocaleString()} skipped, {result.errors.toLocaleString()} with errors.
            {result.addedOptions.length > 0 && ` Added ${result.addedOptions.length} new dropdown values.`}
            {result.dynamics > 0 && ` Dynamics targets, numbers, calls and notes were added for ${result.dynamics.toLocaleString()} ${result.dynamics === 1 ? "record" : "records"}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {result.segmentId && (
              <Button variant="primary" asChild>
                <Link href={`/segments/${result.segmentId}`}>View the imported {plural}</Link>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link href={object === "CONTACT" ? "/contacts" : "/companies"}>Go to {plural}</Link>
            </Button>
            <Button variant="ghost" onClick={() => (setStep("upload"), setSheet(null), setReview(null), setResult(null))}>
              Import another file
            </Button>
          </div>
          {result.failed.length > 0 && <ErrorList failed={result.failed} onDownload={() => downloadErrors(result.failed)} />}
        </div>
      )}
    </div>
  );
}

function ErrorList({ failed, onDownload }: { failed: ImportRowResult[]; onDownload: () => void }) {
  return (
    <section className="rounded-[4px] border border-line">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex-1 text-[14px] font-semibold">Rows with errors ({failed.length.toLocaleString()})</h2>
        <Button size="sm" variant="secondary" onClick={onDownload}>
          <Download /> Download rows with errors
        </Button>
      </div>
      <ul className="thin-scroll max-h-[280px] overflow-y-auto px-4 py-2 text-[13px]">
        {failed.slice(0, 200).map((f) => (
          <li key={f.row} className="border-b border-line py-1 last:border-b-0">
            <span className="font-medium">Row {f.row}:</span> <span className="text-ink-muted">{f.message}</span>
          </li>
        ))}
        {failed.length > 200 && <li className="py-1 text-ink-subtle">…and {failed.length - 200} more in the download</li>}
      </ul>
    </section>
  );
}

function FormatGuide({ object, plural }: { object: ImportObject; plural: string }) {
  const q = `object=${plural}`;
  return (
    <aside className="space-y-3 rounded-[6px] border border-line bg-surface-muted p-4 text-[13px]">
      <h2 className="text-[14px] font-semibold">File format</h2>
      <div className="flex flex-col gap-1.5">
        <a href={`/api/import/template?${q}&kind=template`} className="flex items-center gap-1.5 text-link hover:underline">
          <Download className="size-4" /> Template: common {object === "CONTACT" ? "contact" : "company"} columns (.csv)
        </a>
        <a href={`/api/import/template?${q}&kind=full`} className="flex items-center gap-1.5 text-link hover:underline">
          <Download className="size-4" /> Template: every importable column (.csv)
        </a>
        <a href={`/api/import/template?${q}&kind=values`} className="flex items-center gap-1.5 text-link hover:underline">
          <Download className="size-4" /> Allowed values for each column (.csv)
        </a>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-ink-muted">
        <li>Row 1 holds the column names; each following row is one {object === "CONTACT" ? "contact" : "company"}. Column order doesn&apos;t matter.</li>
        <li>Headers that match a property name (e.g. &ldquo;Job title&rdquo;, &ldquo;Lead status&rdquo;) are mapped automatically; any other column can be mapped by hand or skipped.</li>
        {object === "CONTACT" ? (
          <>
            <li>Each contact needs a first name, last name or email. Existing contacts are matched by email.</li>
            <li>&ldquo;Company name&rdquo; / &ldquo;Company domain&rdquo; link the contact to its company (matched by domain, then name) and create the company if it&apos;s new.</li>
          </>
        ) : (
          <>
            <li>Each company needs a name or domain. Existing companies are matched by domain (www and https:// are ignored).</li>
            <li>New companies start their lead journey at &ldquo;Sourced&rdquo; unless the file has a Lead journey stage.</li>
          </>
        )}
        <li>Dropdowns must use one of the allowed values (case doesn&apos;t matter); multi-select values are separated by &ldquo;;&rdquo;.</li>
        <li>Dates: YYYY-MM-DD, MM/DD/YYYY or real Excel dates. Times are Asia/Dhaka.</li>
        <li>Owner / user columns: the user&apos;s email or full name. Yes/No columns: Yes, No, TRUE, FALSE, 1, 0.</li>
        <li>Phone numbers in any format; 10-digit numbers are treated as US (+1). Put extra numbers in one column separated by &ldquo;;&rdquo;.</li>
        <li>.xls files: open in Excel and save as .xlsx or &ldquo;CSV UTF-8&rdquo;.</li>
      </ul>
      <h3 className="pt-1 text-[13px] font-semibold">Dynamics CRM lead exports</h3>
      <ul className="list-disc space-y-1 pl-4 text-ink-muted">
        <li>Import leads as {object === "CONTACT" ? "contacts" : "contacts (one row per lead person)"}; the company data copied onto each lead fills its company (matched by domain, then name).</li>
        <li>
          <strong>Description</strong>: lines after &ldquo;Targets&gt;&gt;&rdquo; become contacts (&ldquo;Name (Title) email phone&rdquo;), lines after &ldquo;Numbers&gt;&gt;&rdquo; become phone numbers with
          their IVR path (&ldquo;813-555-0100 Main: DBND 9, Sales 1, OPT 0&rdquo;).
        </li>
        <li>
          <strong>Caller Notes</strong>: entries like &ldquo;10/23/2026: 01:56 PM: CRT: (325-223-9500 OPT) VM.&rdquo; become logged calls with their date, number, path and outcome; other dated entries become
          notes.
        </li>
        <li>Both columns are recognised automatically. You review everything the parsers found before importing; anything they can&apos;t read is kept as a note.</li>
      </ul>
    </aside>
  );
}
