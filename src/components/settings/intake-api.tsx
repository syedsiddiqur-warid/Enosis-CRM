"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pill } from "@/components/index/values";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { createApiKey, revokeApiKey, updateApiKey, type ApiKeyInput } from "@/lib/crm/api-key-actions";
import { friendlyDateTime } from "@/lib/crm/dates";
import type { PropOption } from "@/lib/crm/types";

type Key = {
  id: string;
  name: string;
  prefix: string;
  source: string | null;
  researcherIds: string[];
  addMissingOptions: boolean;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
  revoked: boolean;
};
type History = { id: string; name: string; summary: Record<string, number> };

const BLANK: ApiKeyInput = { name: "", source: null, researcherIds: [], addMissingOptions: true };

const EXAMPLE = `{
  "batch": "Apollo – US healthcare",
  "companies": [
    {
      "name": "Example Health",
      "website": "examplehealth.com",
      "industry": "Healthcare",
      "country": "United States",
      "state": "TX",
      "employees": 120,
      "phone": "+1 512 555 0100",
      "people": [
        { "firstName": "Alex", "lastName": "Sample", "jobTitle": "CTO", "email": "alex@examplehealth.com", "phone": "+1 512 555 0142" }
      ]
    }
  ]
}`;

export function IntakeApiSettings({
  endpoint,
  isAdmin,
  leadSources,
  researchers,
  keys,
  history,
}: {
  endpoint: string;
  isAdmin: boolean;
  leadSources: PropOption[];
  researchers: { id: string; name: string }[];
  keys: Key[];
  history: History[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ApiKeyInput>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const save = () =>
    start(async () => {
      setError(null);
      const res = editing ? await updateApiKey(editing, form) : await createApiKey(form);
      if (!res.ok) return setError(res.error);
      if (!editing && res.data && "key" in res.data) setNewKey(res.data.key);
      setForm(BLANK);
      setEditing(null);
      router.refresh();
    });
  const revoke = (k: Key) => {
    if (!confirm(`Revoke the key for ${k.name}? The tool using it stops sending companies at once.`)) return;
    start(async () => {
      const res = await revokeApiKey(k.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  };
  const sourceLabel = (v: string | null) => (v ? (leadSources.find((o) => o.value === v)?.label ?? v) : "Not set");
  const researcherNames = (ids: string[]) => ids.map((id) => researchers.find((r) => r.id === id)?.name).filter(Boolean).join(", ") || "Unassigned";
  const curl = `curl -X POST "${endpoint}" \\\n  -H "Authorization: Bearer ecrm_..." \\\n  -H "Content-Type: application/json" \\\n  -d @companies.json`;

  return (
    <div className="thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-8 py-6">
      <h1 className="text-[22px] font-medium">Intake API</h1>
      <p className="mt-1 max-w-[780px] text-[13px] text-ink-muted">
        Lead generation tools (Apollo, Clay, Zapier, Make or your own scripts) send companies and their people here. They land in the Research Queue as new, with the key&apos;s lead source and a
        batch, and go through the same duplicate check as file imports: an existing company is matched by website or name and only its empty fields are filled.
      </p>
      {error && <p className="mt-3 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      {newKey && (
        <div className="mt-4 max-w-[780px] rounded-[6px] border border-[#00bda5] bg-[#e5f8f6] p-4 text-[13px]">
          <p className="font-medium">Copy this key now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-[3px] bg-surface px-2 py-1.5 font-mono text-[12px]">{newKey}</code>
            <Button size="sm" variant="secondary" onClick={() => copy(newKey, "key")}>
              {copied === "key" ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
            </Button>
          </div>
          <p className="mt-2 text-ink-muted">Paste it into the tool as a Bearer token (Authorization header) or as an X-API-Key header.</p>
          <button className="mt-2 text-[12px] text-link hover:underline" onClick={() => setNewKey(null)}>
            I&apos;ve saved it
          </button>
        </div>
      )}

      {isAdmin ? (
        <section className="mt-5 max-w-[780px] rounded-[6px] border border-line p-4">
          <h2 className="text-[15px] font-semibold">{editing ? "Edit key" : "New key"}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="key-name">Tool</Label>
              <Input id="key-name" placeholder="e.g. Apollo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="key-source">Lead source</Label>
              <Select id="key-source" value={form.source ?? ""} onChange={(e) => setForm({ ...form, source: e.target.value || null })}>
                <option value="">--</option>
                {leadSources.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-3 text-[13px]">
            <div className="mb-1 font-medium">Researchers (new companies are shared out evenly)</div>
            {researchers.length ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {researchers.map((r) => (
                  <label key={r.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={form.researcherIds.includes(r.id)}
                      onCheckedChange={(v) => setForm({ ...form, researcherIds: v === true ? [...form.researcherIds, r.id] : form.researcherIds.filter((x) => x !== r.id) })}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-ink-muted">No users have the Researcher role yet; companies arrive unassigned.</p>
            )}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <Checkbox checked={form.addMissingOptions} onCheckedChange={(v) => setForm({ ...form, addMissingOptions: v === true })} />
            Add dropdown values the CRM doesn&apos;t have yet (e.g. a new industry) instead of rejecting the company
          </label>
          <div className="mt-4 flex gap-2">
            <Button disabled={pending || !form.name.trim()} onClick={save}>
              {editing ? "Save" : "Create key"}
            </Button>
            {editing && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setForm(BLANK);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </section>
      ) : (
        <p className="mt-4 text-[13px] text-ink-muted">Only admins can create or revoke keys.</p>
      )}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">Keys</h2>
      {keys.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="text-left text-[12px] text-ink-muted">
              <tr className="border-b border-line">
                {["Tool", "Key", "Lead source", "Researchers", "Last used", "Requests", "Status", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={`border-b border-line ${k.revoked ? "text-ink-subtle" : ""}`}>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      <KeyRound className="size-4 text-ink-muted" />
                      {k.name}
                    </div>
                    <div className="text-[12px] text-ink-subtle">
                      {k.createdBy ?? "Unknown"}, {friendlyDateTime(k.createdAt)}
                    </div>
                  </td>
                  <td className="px-2 py-2 font-mono text-[12px]">{k.prefix}…</td>
                  <td className="px-2 py-2">{sourceLabel(k.source)}</td>
                  <td className="px-2 py-2">{researcherNames(k.researcherIds)}</td>
                  <td className="whitespace-nowrap px-2 py-2">{k.lastUsedAt ? friendlyDateTime(k.lastUsedAt) : "Never"}</td>
                  <td className="px-2 py-2">{k.useCount.toLocaleString()}</td>
                  <td className="px-2 py-2">{k.revoked ? <Pill label="Revoked" color="#cbd6e2" /> : <Pill label="Active" color="#00bda5" />}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {isAdmin && !k.revoked && (
                      <>
                        <button
                          className="text-link hover:underline"
                          onClick={() => {
                            setEditing(k.id);
                            setNewKey(null);
                            setForm({ name: k.name, source: k.source, researcherIds: k.researcherIds, addMissingOptions: k.addMissingOptions });
                          }}
                        >
                          Edit
                        </button>
                        <button className="ml-3 text-danger hover:underline" disabled={pending} onClick={() => revoke(k)}>
                          Revoke
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">No keys yet.</p>
      )}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">What came in</h2>
      {history.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead className="text-left text-[12px] text-ink-muted">
              <tr className="border-b border-line">
                {["Tool and day", "Requests", "Companies", "New", "Matched", "Skipped", "Errors"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((j) => (
                <tr key={j.id} className="border-b border-line">
                  <td className="px-2 py-2">{j.name}</td>
                  {(["requests", "totalRows", "created", "updated", "skipped", "errors"] as const).map((f) => (
                    <td key={f} className={`px-2 py-2 ${f === "errors" && j.summary[f] ? "text-danger" : ""}`}>
                      {(j.summary[f] ?? 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">Nothing has been sent yet.</p>
      )}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">How to send companies</h2>
      <div className="max-w-[780px] space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[3px] bg-surface-muted px-1.5 py-0.5 font-mono text-[12px] font-semibold">POST</span>
          <code className="min-w-[220px] flex-1 break-all font-mono text-[12px]">{endpoint}</code>
          <Button size="sm" variant="secondary" onClick={() => copy(endpoint, "url")}>
            {copied === "url" ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
          </Button>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-ink-muted">
          <li>
            Headers: <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> (or <code className="font-mono">X-API-Key</code>) and <code className="font-mono">Content-Type: application/json</code>.
          </li>
          <li>
            Body: one company, an array of companies, or <code className="font-mono">{"{ companies: [...] }"}</code> with up to 500 companies. <code className="font-mono">batch</code> and{" "}
            <code className="font-mono">source</code> are optional; without a batch, each day gets its own (e.g. &quot;2026-11-02 API Apollo&quot;).
          </li>
          <li>
            Field names are matched like spreadsheet columns, so <code className="font-mono">website</code>, <code className="font-mono">domain</code> and <code className="font-mono">companyWebsite</code> all
            work. People go in <code className="font-mono">people</code> (or <code className="font-mono">contacts</code>); each becomes a contact linked to the company.
          </li>
          <li>
            Add <code className="font-mono">?dryRun=1</code> to check a request without saving anything. The reply lists each company as created, updated, skipped or error, and any fields that
            weren&apos;t recognised.
          </li>
        </ul>
        <pre className="thin-scroll overflow-x-auto rounded-[6px] bg-surface-muted p-3 font-mono text-[12px]">{EXAMPLE}</pre>
        <pre className="thin-scroll overflow-x-auto rounded-[6px] bg-surface-muted p-3 font-mono text-[12px]">{curl}</pre>
      </div>
    </div>
  );
}
