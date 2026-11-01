"use client";

// One deal: stage path, key fields (edit in place), notes and activity, and the company and people on it.
import { ArrowLeft, Building2, Check, Handshake, Plus, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CompanyLogo, Pill } from "@/components/index/values";
import { FollowBadge } from "@/components/prospecting/calling-queue";
import { activitySummary } from "@/lib/crm/activity-format";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/crm/dates";
import { addDealNote, companyPeople, deleteDeals, moveDeal, setDealContact, updateDeal } from "@/lib/crm/deal-actions";
import type { DealData } from "@/lib/crm/deal-loader";
import { DEAL_TYPES, LOST_REASONS } from "@/lib/crm/deals";
import { leadStageColor } from "@/lib/crm/leads";
import { cn, formatNumber } from "@/lib/utils";
import { ReasonDialog } from "./reason-dialog";

export function DealDetail({ data }: { data: DealData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [lostStage, setLostStage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const d = data.deal;
  const stage = data.stages.find((s) => s.id === d.stageId);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? (done ?? null) : res.error);
      if (res.ok) router.refresh();
    });
  const move = (stageId: string, reason?: string) => {
    const to = data.stages.find((s) => s.id === stageId);
    if (!to || stageId === d.stageId) return;
    if (to.stageType === "LOST" && !reason) return setLostStage(stageId);
    run(() => moveDeal(d.id, stageId, reason), to.stageType === "WON" ? "Deal won 🎉" : `Moved to ${to.name}`);
  };
  const save = (patch: Parameters<typeof updateDeal>[1]) => run(() => updateDeal(d.id, patch), "Saved");

  return (
    <div className="flex h-full min-h-[560px] overflow-hidden rounded-[6px] border border-line bg-surface">
      {/* Left: key fields */}
      <aside className="thin-scroll w-[320px] shrink-0 overflow-y-auto border-r border-line">
        <div className="border-b border-line p-5">
          <Link href="/deals" className="mb-3 flex items-center gap-1 text-[13px] text-link hover:underline">
            <ArrowLeft className="size-3.5" /> Deals
          </Link>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fef1dc] text-[#b97a0e]">
              <Handshake className="size-5" />
            </span>
            <InlineText value={d.name} onSave={(name) => save({ name })} className="text-[18px] font-medium" />
          </div>
          <div className="mt-3 text-[13px] text-ink-muted">
            Amount: <span className="font-medium text-ink">{d.amount === null ? "--" : formatNumber(d.amount, "currency")}</span>
          </div>
          <div className="text-[13px] text-ink-muted">
            Close date: <span className="font-medium text-ink">{d.closeDate ? formatDate(d.closeDate) : "--"}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
            Stage: {stage && <Pill label={stage.name} color={stage.color} />}
          </div>
          {d.lostReason && <div className="mt-1 text-[13px] text-ink-muted">Lost because: {d.lostReason}</div>}
        </div>
        <div className="space-y-3 p-5">
          <h2 className="text-[13px] font-semibold">About this deal</h2>
          <Field label="Amount (USD)">
            <Input
              type="number"
              min={0}
              step="any"
              defaultValue={d.amount ?? ""}
              key={`a${d.amount}`}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== d.amount) save({ amount: v });
              }}
            />
          </Field>
          <Field label="Close date">
            <Input
              type="date"
              defaultValue={d.closeDate?.slice(0, 10) ?? ""}
              key={`c${d.closeDate}`}
              onChange={(e) => save({ closeDate: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })}
            />
          </Field>
          <Field label="Pipeline">
            <div className="text-[13px]">{data.pipeline.name}</div>
          </Field>
          <Field label="Deal stage">
            <Select value={d.stageId} onChange={(e) => move(e.target.value)}>
              {data.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.probability}%)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deal owner">
            <Select value={d.ownerId ?? ""} onChange={(e) => save({ ownerId: e.target.value || null })}>
              <option value="">No owner</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deal type">
            <Select value={d.dealType ?? ""} onChange={(e) => save({ dealType: e.target.value || null })}>
              <option value="">None</option>
              {DEAL_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Source campaign">
            <Input defaultValue={d.sourceCampaign ?? ""} key={`s${d.sourceCampaign}`} onBlur={(e) => e.target.value !== (d.sourceCampaign ?? "") && save({ sourceCampaign: e.target.value || null })} />
          </Field>
          <Field label="Created">
            <div className="text-[13px]">{formatDateTime(d.createdAt)}</div>
          </Field>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() =>
              start(async () => {
                const res = await deleteDeals([d.id]);
                if (!res.ok) return setMessage(res.error);
                router.push("/deals");
              })
            }
          >
            <Trash2 /> Delete deal
          </Button>
        </div>
      </aside>

      {/* Middle: stage path, notes, activity */}
      <main className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-surface-muted">
        {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
        <div className="border-b border-line bg-surface px-5 py-4">
          <div className="flex overflow-x-auto" role="list" aria-label="Deal stages">
            {data.stages.map((s, i) => {
              const current = s.id === d.stageId;
              const passed = !!stage && stage.stageType === "OPEN" && data.stages.indexOf(stage) > i;
              return (
                <button
                  key={s.id}
                  role="listitem"
                  onClick={() => move(s.id)}
                  title={`${s.name}${s.days ? ` · ${s.days} days` : ""}`}
                  className={cn(
                    "relative -ml-px min-w-[110px] flex-1 border border-line px-3 py-2 text-left text-[12px] first:ml-0 first:rounded-l-[4px] last:rounded-r-[4px]",
                    current ? "z-10 font-semibold text-white" : passed ? "bg-[#e5f5f8]" : "bg-surface hover:bg-surface-hover",
                  )}
                  style={current ? { background: s.color, borderColor: s.color } : undefined}
                >
                  <div className="flex items-center gap-1 truncate">
                    {passed && <Check className="size-3 text-link" />}
                    {s.name}
                  </div>
                  <div className={cn("text-[11px]", current ? "text-white/90" : "text-ink-subtle")}>{s.days ? `${s.days}d` : `${s.probability}%`}</div>
                </button>
              );
            })}
          </div>
          {message && <p className="mt-2 text-[13px] text-ink-muted">{message}</p>}
        </div>
        <div className="space-y-3 p-5">
          <form
            className="rounded-[4px] border border-line bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addDealNote(d.id, note), "Note added");
              setNote("");
            }}
          >
            <Label htmlFor="deal-note">Add a note</Label>
            <textarea
              id="deal-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened, what's next, who decides…"
              className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-link"
            />
            <div className="mt-2 flex justify-end">
              <Button type="submit" size="sm" variant="primary" disabled={!note.trim() || pending}>
                Save note
              </Button>
            </div>
          </form>
          <h2 className="pt-2 text-[13px] font-semibold">Activity</h2>
          {data.activities.length ? (
            <ul className="space-y-2">
              {data.activities.map((a) => {
                const owner = data.users.find((u) => u.id === a.ownerId);
                return (
                  <li key={a.id} className="rounded-[4px] border border-line bg-surface p-3 text-[13px]">
                    <div className="flex items-center gap-2">
                      <Pill label={a.type === "SYSTEM" ? "Update" : a.type.charAt(0) + a.type.slice(1).toLowerCase()} />
                      <span className="font-medium">{activitySummary(a)}</span>
                      <span className="ml-auto whitespace-nowrap text-[12px] text-ink-subtle">{formatDateTime(a.occurredAt)}</span>
                    </div>
                    {a.type === "NOTE" && a.body && <p className="mt-1.5 whitespace-pre-wrap text-ink-muted">{a.body.replace(/<[^>]+>/g, "")}</p>}
                    {a.type === "CALL" && a.body && <p className="mt-1.5 line-clamp-3 text-ink-muted">{a.body.replace(/<[^>]+>/g, "")}</p>}
                    <div className="mt-1 text-[12px] text-ink-subtle">
                      {[owner?.name ?? owner?.email, a.contacts.map((c) => c.name).join(", "), a.feedbackRating].filter(Boolean).join(" · ")}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-muted">No activity yet. Notes added here also show on the company and people.</p>
          )}
        </div>
      </main>

      {/* Right: company, people, lead */}
      <aside className="thin-scroll w-[320px] shrink-0 space-y-4 overflow-y-auto border-l border-line p-5">
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Building2 className="size-4" /> Company
          </h2>
          {data.companies.length ? (
            data.companies.map((c) => (
              <div key={c.id} className="rounded-[4px] border border-line p-2.5 text-[13px]">
                <Link href={`/companies/${c.id}`} className="flex items-center gap-2 font-medium text-link hover:underline">
                  <CompanyLogo name={c.name} domain={c.domain} size={20} /> {c.name}
                </Link>
                <div className="mt-1 text-[12px] text-ink-muted">{[c.industry, c.country].filter(Boolean).join(" · ")}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {c.leadState && <Pill label={c.leadState} />}
                  {c.followGroup && <FollowBadge group={c.followGroup} score={c.followScore} />}
                </div>
              </div>
            ))
          ) : (
            <p className="text-[13px] text-ink-muted">No company linked.</p>
          )}
        </section>
        <People data={data} onMessage={setMessage} />
        {data.leads.length > 0 && (
          <section>
            <h2 className="mb-2 text-[13px] font-semibold">Came from lead</h2>
            {data.leads.map((l) => (
              <Link key={l.id} href={`/leads?view=list&owner=__all__&q=${encodeURIComponent(l.name.split(" – ")[0])}`} className="flex items-center gap-2 text-[13px] text-link hover:underline">
                <Pill label={l.stage} color={leadStageColor(l.stage)} /> {l.name}
              </Link>
            ))}
          </section>
        )}
      </aside>

      {lostStage && (
        <ReasonDialog
          title="Mark deal as lost"
          intro="Why was this deal lost? This helps spot patterns later."
          reasons={LOST_REASONS}
          confirm="Mark lost"
          onCancel={() => setLostStage(null)}
          onConfirm={(reason) => {
            const s = lostStage;
            setLostStage(null);
            move(s, reason);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function InlineText({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing)
    return (
      <button className={cn("text-left hover:underline", className)} onClick={() => setEditing(true)} title="Rename">
        {value}
      </button>
    );
  return (
    <Input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (v.trim() && v !== value) onSave(v.trim());
        else setV(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value);
          setEditing(false);
        }
      }}
    />
  );
}

function People({ data, onMessage }: { data: DealData; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string; jobTitle: string | null }[]>([]);
  const [pending, start] = useTransition();
  const company = data.companies[0];
  useEffect(() => {
    if (adding && company) companyPeople(company.id).then((p) => setOptions(p.filter((x) => !data.contacts.some((c) => c.id === x.id))));
  }, [adding, company, data.contacts]);
  const link = (contactId: string, linked: boolean) =>
    start(async () => {
      const res = await setDealContact(data.deal.id, contactId, linked);
      if (!res.ok) return onMessage(res.error);
      setAdding(false);
      router.refresh();
    });
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <UserRound className="size-4" /> People ({data.contacts.length})
        {company && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAdding((a) => !a)} disabled={pending}>
            <Plus /> Add
          </Button>
        )}
      </h2>
      {adding && (
        <div className="mb-2 rounded-[4px] border border-line p-2">
          {options.length ? (
            options.map((p) => (
              <button key={p.id} className="block w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-surface-hover" onClick={() => link(p.id, true)}>
                {p.name}
                {p.jobTitle && <span className="text-ink-subtle"> · {p.jobTitle}</span>}
              </button>
            ))
          ) : (
            <p className="px-2 py-1 text-[12px] text-ink-subtle">Everyone at {company?.name} is already on this deal.</p>
          )}
        </div>
      )}
      <ul className="space-y-2">
        {data.contacts.map((c) => (
          <li key={c.id} className="group rounded-[4px] border border-line p-2.5 text-[13px]">
            <div className="flex items-center gap-2">
              <Link href={`/contacts/${c.id}`} className="font-medium text-link hover:underline">
                {c.name}
              </Link>
              <button className="ml-auto hidden text-ink-subtle hover:text-danger group-hover:block" onClick={() => link(c.id, false)} aria-label={`Remove ${c.name} from deal`}>
                <X className="size-3.5" />
              </button>
            </div>
            <div className="text-[12px] text-ink-muted">{[c.jobTitle, c.lifecycleStage].filter(Boolean).join(" · ")}</div>
            {(c.mobile ?? c.phone) && <div className="text-[12px] text-ink-muted">{c.mobile ?? c.phone}</div>}
          </li>
        ))}
      </ul>
      {!data.contacts.length && !adding && <p className="text-[13px] text-ink-muted">No people on this deal yet.</p>}
    </section>
  );
}
