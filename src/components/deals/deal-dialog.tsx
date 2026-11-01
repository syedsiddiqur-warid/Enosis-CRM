"use client";

// Create a deal: from the Deals page, a company or contact record, a Follow-ups row, or by qualifying a lead.
import { Building2, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Checkbox, Dialog, DialogContent } from "@/components/ui/overlays";
import { searchCompanies } from "@/lib/crm/actions";
import { companyPeople, createDeal, dealFormOptions } from "@/lib/crm/deal-actions";
import { DEAL_TYPES } from "@/lib/crm/deals";

export interface DealDefaults {
  name?: string;
  company?: { id: string; name: string } | null;
  contactIds?: string[];
  leadId?: string | null;
  stageId?: string;
  sourceCampaign?: string | null;
}

type Options = Awaited<ReturnType<typeof dealFormOptions>>;

export function CreateDealDialog({ defaults, onClose, onCreated }: { defaults: DealDefaults; onClose: () => void; onCreated: (id: string, message: string) => void }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [company, setCompany] = useState(defaults.company ?? null);
  const [people, setPeople] = useState<{ id: string; name: string; jobTitle: string | null }[]>([]);
  const [contactIds, setContactIds] = useState<Set<string>>(new Set(defaults.contactIds ?? []));
  const [f, setF] = useState({
    name: defaults.name ?? (defaults.company ? `${defaults.company.name} – Staff Augmentation` : ""),
    pipelineId: "",
    stageId: defaults.stageId ?? "",
    amount: "",
    closeDate: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
    ownerId: "",
    dealType: "Staff Augmentation",
    sourceCampaign: defaults.sourceCampaign ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    dealFormOptions().then((o) => {
      setOpts(o);
      const p = o.pipelines[0];
      setF((x) => ({ ...x, pipelineId: p?.id ?? "", stageId: x.stageId || (p?.stages.find((s) => s.stageType === "OPEN")?.id ?? ""), ownerId: o.currentUserId }));
    });
  }, []);
  useEffect(() => {
    if (!company) return setPeople([]);
    companyPeople(company.id).then(setPeople);
  }, [company]);

  const pipeline = opts?.pipelines.find((p) => p.id === f.pipelineId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title={defaults.leadId ? "Qualify lead – create deal" : "Create deal"} className="w-[480px]">
        <form
          className="thin-scroll flex-1 space-y-3 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await createDeal({
                name: f.name,
                pipelineId: f.pipelineId || undefined,
                stageId: f.stageId || undefined,
                amount: f.amount ? Number(f.amount) : null,
                closeDate: f.closeDate ? new Date(`${f.closeDate}T12:00:00`).toISOString() : null,
                ownerId: f.ownerId || null,
                dealType: f.dealType || null,
                sourceCampaign: f.sourceCampaign || null,
                companyId: company?.id ?? null,
                contactIds: [...contactIds],
                leadId: defaults.leadId ?? null,
              });
              if (!res.ok) return setError(res.error);
              onCreated(res.data!.id, defaults.leadId ? "Lead qualified and deal created" : "Deal created");
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          {defaults.leadId && (
            <p className="rounded-[3px] bg-[#e5f8f6] px-3 py-2 text-[13px]">The lead moves to Qualified, and the company becomes an Opportunity.</p>
          )}
          <div>
            <Label htmlFor="d-name">Deal name</Label>
            <Input id="d-name" value={f.name} onChange={set("name")} autoFocus maxLength={200} placeholder="e.g. Acme – 3 .NET developers" />
          </div>
          {defaults.company ? (
            <div className="text-[13px] text-ink-muted">
              Company <span className="font-medium text-ink">{company?.name}</span>
            </div>
          ) : (
            <CompanyPicker
              value={company}
              onChange={(c) => {
                setCompany(c);
                setContactIds(new Set());
                if (c && !f.name.trim()) setF((x) => ({ ...x, name: `${c.name} – ${x.dealType || "Deal"}` }));
              }}
            />
          )}
          {people.length > 0 && (
            <div>
              <Label>People on this deal</Label>
              <div className="thin-scroll max-h-[140px] space-y-1 overflow-y-auto rounded-[3px] border border-line p-2">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px]">
                    <Checkbox
                      checked={contactIds.has(p.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(contactIds);
                        if (v) n.add(p.id);
                        else n.delete(p.id);
                        setContactIds(n);
                      }}
                    />
                    <span className="truncate">
                      {p.name}
                      {p.jobTitle && <span className="text-ink-subtle"> · {p.jobTitle}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {(opts?.pipelines.length ?? 0) > 1 && (
              <div className="col-span-2">
                <Label htmlFor="d-pipeline">Pipeline</Label>
                <Select
                  id="d-pipeline"
                  value={f.pipelineId}
                  onChange={(e) => {
                    const p = opts!.pipelines.find((x) => x.id === e.target.value);
                    setF((x) => ({ ...x, pipelineId: e.target.value, stageId: p?.stages[0]?.id ?? "" }));
                  }}
                >
                  {opts!.pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="d-stage">Stage</Label>
              <Select id="d-stage" value={f.stageId} onChange={set("stageId")}>
                {pipeline?.stages
                  .filter((s) => s.stageType !== "LOST")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.probability}%)
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="d-type">Deal type</Label>
              <Select id="d-type" value={f.dealType} onChange={set("dealType")}>
                <option value="">None</option>
                {DEAL_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="d-amount">Amount (USD)</Label>
              <Input id="d-amount" type="number" min={0} step="any" value={f.amount} onChange={set("amount")} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="d-close">Close date</Label>
              <Input id="d-close" type="date" value={f.closeDate} onChange={set("closeDate")} />
            </div>
            <div>
              <Label htmlFor="d-owner">Deal owner</Label>
              <Select id="d-owner" value={f.ownerId} onChange={set("ownerId")}>
                <option value="">No owner</option>
                {opts?.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                    {u.id === opts.currentUserId ? " (me)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="d-campaign">Source campaign</Label>
              <Select id="d-campaign" value={f.sourceCampaign} onChange={set("sourceCampaign")}>
                <option value="">None</option>
                {[...new Set([...(opts?.campaigns ?? []), ...(f.sourceCampaign ? [f.sourceCampaign] : [])])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !opts || !f.name.trim() || (!company && !contactIds.size && !defaults.leadId)}>
              {defaults.leadId ? "Qualify & create deal" : "Create deal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompanyPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; domain: string | null }[]>([]);
  useEffect(() => {
    if (value) return;
    const t = setTimeout(() => searchCompanies(q.trim()).then(setHits), 200);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value)
    return (
      <div>
        <Label>Company</Label>
        <div className="flex h-8 items-center gap-2 rounded-[3px] border border-line-strong px-2.5 text-[13px]">
          <Building2 className="size-4 text-ink-subtle" />
          <span className="flex-1 truncate">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Change company" className="text-ink-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  return (
    <div>
      <Label htmlFor="d-company">Company</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <Input id="d-company" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="pl-8" />
      </div>
      {hits.length > 0 && (
        <ul className="mt-1 max-h-[180px] overflow-y-auto rounded-[3px] border border-line">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-hover" onClick={() => onChange({ id: h.id, name: h.name })}>
                <Building2 className="size-3.5 text-ink-subtle" />
                <span className="truncate">{h.name}</span>
                {h.domain && <span className="truncate text-[12px] text-ink-subtle">{h.domain}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
