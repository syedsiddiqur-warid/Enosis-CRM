"use client";

import { CheckSquare, FileText, Mail, Phone, RefreshCcw, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { getRecordPreview, type RecordPreview } from "@/lib/crm/actions";
import { activitySummary } from "@/lib/crm/activity-format";
import { formatDateTime } from "@/lib/crm/dates";
import type { IndexRow } from "@/lib/crm/query";
import type { CrmObject, PropDef, UserLite } from "@/lib/crm/types";
import { CompanyLogo, PropValue } from "./values";

const ICONS = { CALL: Phone, EMAIL: Mail, NOTE: FileText, TASK: CheckSquare, MEETING: Users, SYSTEM: RefreshCcw };

export function PreviewDrawer({
  object,
  row,
  basePath,
  defs,
  previewProperties,
  users,
  onOpenChange,
}: {
  object: CrmObject;
  row: IndexRow | null;
  basePath: string;
  defs: PropDef[];
  previewProperties: string[];
  users: UserLite[];
  onOpenChange: (o: boolean) => void;
}) {
  const [data, setData] = useState<RecordPreview | null>(null);
  useEffect(() => {
    setData(null);
    if (!row) return;
    let live = true;
    getRecordPreview(object, row.id).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [object, row]);

  const props = previewProperties.map((p) => defs.find((d) => d.name === p)).filter((d): d is PropDef => !!d);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent side="right" title={object === "CONTACT" ? "Contact preview" : "Company preview"}>
        {row && (
          <div className="thin-scroll flex-1 overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-line px-6 py-5">
              {object === "COMPANY" ? (
                <CompanyLogo name={row.name} domain={row.domain} size={44} />
              ) : (
                <span className="flex size-11 items-center justify-center rounded-full bg-[#eaf0f6] text-[15px] font-semibold text-ink-muted">
                  {row.name
                    .split(" ")
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-[17px] font-medium">{row.name}</div>
                <div className="truncate text-[13px] text-ink-muted">
                  {object === "CONTACT" ? [row.subtitle, row.primaryCompany?.name].filter(Boolean).join(" at ") : row.domain}
                </div>
                <Link href={`${basePath}/${row.id}`} className="text-[13px] font-medium text-link hover:underline">
                  View record
                </Link>
              </div>
            </div>
            <section className="border-b border-line px-6 py-4">
              <h3 className="mb-3 text-[13px] font-semibold">Key information</h3>
              <dl className="space-y-3">
                {props.map((d) => (
                  <div key={d.name}>
                    <dt className="text-[12px] text-ink-muted">{d.label}</dt>
                    <dd className="text-[13px]">
                      <PropValue def={d} value={row.values[d.name]} users={users} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="px-6 py-4">
              <h3 className="mb-3 text-[13px] font-semibold">Recent activity</h3>
              {!data && <div className="text-[13px] text-ink-subtle">Loading…</div>}
              {data && !data.activities.length && <div className="text-[13px] text-ink-subtle">No activity yet</div>}
              <ol className="space-y-3">
                {data?.activities.map((a) => {
                  const Icon = ICONS[a.type];
                  return (
                    <li key={a.id} className="flex gap-3">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted">
                        <Icon className="size-3.5 text-ink-muted" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px]">{activitySummary(a)}</div>
                        <div className="text-[12px] text-ink-subtle">
                          {formatDateTime(a.occurredAt)}
                          {a.owner?.name ? ` · ${a.owner.name}` : ""}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
