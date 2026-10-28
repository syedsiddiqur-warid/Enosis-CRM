"use client";

import { CheckCircle2, CircleDashed, FileUp, PlugZap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pill } from "@/components/index/values";
import { Checkbox } from "@/components/ui/overlays";
import { setIntegration } from "@/lib/crm/company-actions";
import { friendlyDateTime } from "@/lib/crm/dates";
import type { IntegrationSettings, ProviderInfo } from "@/lib/crm/integrations";

type Provider = ProviderInfo & { configured: boolean; enabled: boolean; settings: IntegrationSettings; lastRunAt: string | null; lastError: string | null };
type Run = { id: string; provider: string; company: { id: string; name: string } | null; status: string; changed: number; error: string | null; at: string };

const RUN_STATUS: Record<string, [string, string]> = {
  updated: ["Updated", "#00bda5"],
  no_change: ["Nothing new", "#cbd6e2"],
  no_match: ["No match", "#f5c26b"],
  failed: ["Failed", "#f2545b"],
};

export function IntegrationsSettings({ providers, runs, isAdmin }: { providers: Provider[]; runs: Run[]; isAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (id: string, patch: Parameters<typeof setIntegration>[1]) =>
    start(async () => {
      setError(null);
      const res = await setIntegration(id, patch);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  const api = providers.filter((p) => p.kind === "api");
  const files = providers.filter((p) => p.kind === "file");

  return (
    <div className="thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-8 py-6">
      <h1 className="text-[22px] font-medium">Integrations</h1>
      <p className="mt-1 max-w-[760px] text-[13px] text-ink-muted">
        Lead-generation and research tools. API connectors enrich companies (firmographics, tech stack, funding signals) from their domain. API keys are set as server environment variables by an admin
        and are never stored in the CRM or shown here.
      </p>
      {error && <p className="mt-3 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">API connectors</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {api.map((p) => (
          <section key={p.id} className="rounded-[6px] border border-line p-4">
            <div className="flex items-center gap-2">
              <PlugZap className="size-5 text-ink-muted" />
              <h3 className="flex-1 text-[15px] font-medium">{p.name}</h3>
              {p.configured ? (
                <span className="flex items-center gap-1 text-[12px] text-[#00a38d]">
                  <CheckCircle2 className="size-4" /> Key found
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[12px] text-ink-subtle">
                  <CircleDashed className="size-4" /> Not connected
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[13px] text-ink-muted">{p.description}</p>
            {!p.configured && (
              <p className="mt-2 rounded-[3px] bg-surface-muted px-3 py-2 text-[12px]">
                To connect, an admin sets <code className="font-mono">{p.envKey}</code> in the server environment (e.g. Vercel project settings or <code className="font-mono">.env</code>) and redeploys.
              </p>
            )}
            <div className="mt-3 space-y-2 text-[13px]">
              <label className="flex items-center gap-2">
                <Checkbox disabled={!isAdmin || pending} checked={p.enabled} onCheckedChange={(v) => save(p.id, { enabled: v === true })} />
                Enabled
              </label>
              {(
                [
                  ["autoEnrichOnCreate", "Enrich new companies automatically (Research intake)"],
                  ["createSignals", "Create buying signals (e.g. recent funding rounds)"],
                  ["overwrite", "Overwrite values that are already filled in"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 pl-6">
                  <Checkbox disabled={!isAdmin || pending || !p.enabled} checked={p.settings[k]} onCheckedChange={(v) => save(p.id, { settings: { [k]: v === true } })} />
                  {l}
                </label>
              ))}
            </div>
            <div className="mt-3 text-[12px] text-ink-subtle">
              {p.lastRunAt ? `Last run ${friendlyDateTime(p.lastRunAt)}` : "Never run"}
              {p.lastError && <span className="text-danger"> · Last error: {p.lastError}</span>}
            </div>
          </section>
        ))}
      </div>
      {!isAdmin && <p className="mt-2 text-[12px] text-ink-subtle">Only admins can change integrations.</p>}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">List sources (no public API)</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {files.map((p) => (
          <section key={p.id} className="flex gap-3 rounded-[6px] border border-line p-4">
            <FileUp className="mt-0.5 size-5 shrink-0 text-ink-muted" />
            <div>
              <h3 className="text-[14px] font-medium">{p.name}</h3>
              <p className="mt-1 text-[13px] text-ink-muted">{p.description}</p>
            </div>
          </section>
        ))}
      </div>
      <p className="mt-2 text-[13px]">
        <Link href="/research" className="text-link hover:underline">
          Open the Research Queue
        </Link>{" "}
        to paste a sourced list.
      </p>

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">Recent enrichment runs</h2>
      {runs.length ? (
        <table className="w-full max-w-[900px] text-[13px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="py-1.5">When</th>
              <th>Source</th>
              <th>Company</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1.5 text-ink-muted">{friendlyDateTime(r.at)}</td>
                <td>{r.provider}</td>
                <td>
                  {r.company ? (
                    <Link href={`/companies/${r.company.id}`} className="text-link hover:underline">
                      {r.company.name}
                    </Link>
                  ) : (
                    "--"
                  )}
                </td>
                <td>
                  <Pill label={RUN_STATUS[r.status]?.[0] ?? r.status} color={RUN_STATUS[r.status]?.[1]} />
                  {r.changed ? <span className="ml-2 text-ink-muted">{r.changed} fields</span> : null}
                  {r.error && <span className="ml-2 text-danger">{r.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[13px] text-ink-subtle">No enrichment runs yet.</p>
      )}
    </div>
  );
}
