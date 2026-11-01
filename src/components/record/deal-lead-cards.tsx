"use client";

// Record page cards for deals and leads, and the record's "Create deal" flow.
import { Handshake, Plus, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CreateDealDialog } from "@/components/deals/deal-dialog";
import { Pill } from "@/components/index/values";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/crm/dates";
import { createLeads } from "@/lib/crm/lead-actions";
import { OPEN_LEAD_STAGES, leadStageColor, type LeadStage } from "@/lib/crm/leads";
import type { LayoutConfig } from "@/lib/crm/record-types";
import { formatNumber } from "@/lib/utils";
import { useRecord } from "./record-context";
import { CARD_ACCENTS, CardGear, RecordCard } from "./record-ui";

type CardConfig = LayoutConfig["right"]["cards"][number];

/** The create-deal dialog prefilled from the open record (its company, and the person on a contact page). */
export function RecordDealDialog({ onClose, leadId }: { onClose: () => void; leadId?: string | null }) {
  const { data, toast } = useRecord();
  const router = useRouter();
  const company = data.object === "COMPANY" ? { id: data.id, name: data.header.name } : data.header.primaryCompany;
  return (
    <CreateDealDialog
      defaults={{ company, contactIds: data.object === "CONTACT" ? [data.id] : [], leadId: leadId ?? null, name: company ? `${company.name} – Staff Augmentation` : undefined }}
      onClose={onClose}
      onCreated={(id, message) => {
        onClose();
        toast({ message });
        router.push(`/deals/${id}`);
      }}
    />
  );
}

export function DealsCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  const [creating, setCreating] = useState(false);
  return (
    <RecordCard
      id={`right:${card.id}`}
      title={card.title ?? "Deals"}
      icon={Handshake}
      accent={CARD_ACCENTS.deals}
      count={data.deals.length}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            <Plus /> Add
          </Button>
          <CardGear label="Card settings" />
        </>
      }
    >
      {data.deals.length ? (
        <ul className="space-y-2">
          {data.deals.slice(0, card.limit ?? 5).map((d) => (
            <li key={d.id} className="rounded-[4px] border border-line p-2.5 text-[13px]">
              <Link href={`/deals/${d.id}`} className="font-medium text-link hover:underline">
                {d.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                <Pill label={d.stage} color={d.stageColor ?? undefined} />
                {d.amount !== null && <span>{formatNumber(d.amount, "currency")}</span>}
                {d.closeDate && <span>Close {formatDate(d.closeDate)}</span>}
              </div>
            </li>
          ))}
          {data.deals.length > (card.limit ?? 5) && (
            <Link href="/deals?view=list" className="block text-[13px] text-link hover:underline">
              View all deals
            </Link>
          )}
        </ul>
      ) : (
        <div className="flex flex-col items-center py-3 text-center">
          <svg width="72" height="52" viewBox="0 0 72 52" aria-hidden className="mb-2">
            <rect x="6" y="10" width="60" height="36" rx="4" fill="var(--surface-muted)" stroke="var(--border-strong)" />
            <rect x="14" y="30" width="8" height="10" rx="1" fill="#00bda5" />
            <rect x="27" y="24" width="8" height="16" rx="1" fill="#00a4bd" />
            <rect x="40" y="18" width="8" height="22" rx="1" fill="#6a78d1" />
            <rect x="53" y="13" width="8" height="27" rx="1" fill="#ff7a59" />
          </svg>
          <p className="text-[13px] text-ink-muted">Track the revenue opportunities associated with this record.</p>
        </div>
      )}
      {creating && <RecordDealDialog onClose={() => setCreating(false)} />}
    </RecordCard>
  );
}

export function LeadsCard() {
  const { data, toast, refresh } = useRecord();
  const [pending, start] = useTransition();
  const [qualifying, setQualifying] = useState<string | null>(null);
  const hasOpen = data.leads.some((l) => OPEN_LEAD_STAGES.includes(l.stage as LeadStage));
  const owner = (id: string | null) => data.users.find((u) => u.id === id);
  return (
    <RecordCard
      id="right:leads"
      title="Leads"
      icon={Target}
      accent="#6a78d1"
      count={data.leads.length}
      actions={
        data.object === "CONTACT" && !hasOpen ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await createLeads([data.id], { source: "Cold call" });
                toast({ message: res.ok ? "Lead created" : res.error });
                if (res.ok) refresh();
              })
            }
          >
            <Plus /> Create lead
          </Button>
        ) : undefined
      }
    >
      {data.leads.length ? (
        <ul className="space-y-2">
          {data.leads.map((l) => {
            const open = OPEN_LEAD_STAGES.includes(l.stage as LeadStage);
            return (
              <li key={l.id} className="rounded-[4px] border border-line p-2.5 text-[13px]">
                <div className="flex items-center gap-2">
                  <Pill label={l.stage} color={leadStageColor(l.stage)} />
                  {l.label && <span className="text-[12px] text-ink-muted">{l.label}</span>}
                  {data.object === "COMPANY" && (
                    <Link href={`/contacts/${l.contact.id}`} className="ml-auto truncate text-[12px] text-link hover:underline">
                      {l.contact.name}
                    </Link>
                  )}
                </div>
                <div className="mt-1 text-[12px] text-ink-muted">
                  {[owner(l.ownerId)?.name, `${l.touches} ${l.touches === 1 ? "call" : "calls"}`, l.lastTouchAt ? `last ${formatDate(l.lastTouchAt)}` : null, l.disqualifyReason].filter(Boolean).join(" · ")}
                </div>
                {open && data.object === "CONTACT" && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setQualifying(l.id)}>
                    Qualify – create deal
                  </Button>
                )}
                {l.dealId && (
                  <Link href={`/deals/${l.dealId}`} className="mt-1 block text-[12px] text-link hover:underline">
                    Open the deal
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-muted">
          {data.object === "CONTACT"
            ? "Not a lead yet. A lead opens automatically after a good conversation, or create one now."
            : "None of these people is a lead yet. Leads open automatically after good conversations."}
        </p>
      )}
      {qualifying && <RecordDealDialog leadId={qualifying} onClose={() => setQualifying(null)} />}
    </RecordCard>
  );
}
