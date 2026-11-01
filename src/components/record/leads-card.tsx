"use client";

// Record page card for the person's (or the company's people's) leads.
import { Plus, Target } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Pill } from "@/components/index/values";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/crm/dates";
import { createLeads, moveLeads } from "@/lib/crm/lead-actions";
import { OPEN_LEAD_STAGES, leadStageColor, type LeadStage } from "@/lib/crm/leads";
import { useRecord } from "./record-context";
import { RecordCard } from "./record-ui";

export function LeadsCard() {
  const { data, toast, refresh } = useRecord();
  const [pending, start] = useTransition();
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
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await moveLeads([l.id], "Qualified");
                        toast({ message: res.ok ? "Lead qualified" : res.error });
                        if (res.ok) refresh();
                      })
                    }
                  >
                    Qualify lead
                  </Button>
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
    </RecordCard>
  );
}
