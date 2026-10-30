"use client";

// Requests callers sent from the calling queue: filter, take or assign them, research, then send the result back.
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CompanyLogo, Pill } from "@/components/index/values";
import { Button, Select } from "@/components/ui/button";
import { Checkbox, Dialog, DialogContent } from "@/components/ui/overlays";
import { friendlyDateTime } from "@/lib/crm/dates";
import { REQUEST_STATUS_COLORS, RESEARCH_REQUEST_KINDS } from "@/lib/crm/research";
import { requestIdsMatching } from "@/lib/crm/research-actions";
import { REQUEST_PAGE, type ResearchData } from "@/lib/crm/research-loader";
import { assignResearchRequests, finishResearchRequests, sendBackResearchRequest } from "@/lib/crm/research-request-actions";
import { cn } from "@/lib/utils";
import { Pager, Progress, inChunks, researcherOptions } from "./research-list";

type Request = ResearchData["requests"]["rows"][number];

const STATUS_TABS = [
  ["waiting", "Waiting"],
  ["mine", "Mine in progress"],
  ["Open", "Not taken"],
  ["Sent back", "Sent back"],
  ["Cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export function CallerRequests({
  data,
  setParams,
  onMessage,
  message,
}: {
  data: ResearchData;
  setParams: (p: Record<string, string>) => void;
  onMessage: (m: string) => void;
  message: string | null;
}) {
  const router = useRouter();
  const r = data.requests;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [answering, setAnswering] = useState<{ list: Request[]; bulk: boolean } | null>(null);
  const [pending, start] = useTransition();
  const people = researcherOptions(data.users, data.researcherIds);
  const pageIds = r.rows.map((x) => x.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const count = allMatching ? allMatching.length : selected.size;
  const filterParams = { rstatus: r.filters.rstatus, kind: r.filters.kind, requester: r.filters.requester };
  const setFilter = (patch: Record<string, string>) => {
    setSelected(new Set());
    setAllMatching(null);
    setParams({ ...patch, rpage: "" });
  };
  const clear = () => {
    setSelected(new Set());
    setAllMatching(null);
  };
  const ids = () => allMatching ?? [...selected];
  const chosen = () => r.rows.filter((x) => ids().includes(x.id));

  async function assign() {
    const list = ids();
    setBusy({ label: "Assigning", done: 0, total: list.length });
    const res = await assignResearchRequests(list, assignTo === "__me__" ? null : assignTo);
    setBusy(null);
    if (!res.ok) return onMessage(res.error);
    onMessage(`${res.data!.updated.toLocaleString()} requests ${assignTo === "__me__" ? "taken by you" : `assigned to ${data.users.find((u) => u.id === assignTo)?.name ?? "the researcher"}`}`);
    clear();
    router.refresh();
  }

  async function finish(action: "send_back" | "cancel", result?: string) {
    const list = ids();
    let done = 0;
    setBusy({ label: action === "send_back" ? "Sending back" : "Cancelling", done: 0, total: list.length });
    await inChunks(
      list,
      25,
      async (chunk) => {
        const res = await finishResearchRequests(chunk, action, result);
        if (res.ok) done += res.data!.done;
      },
      (n) => setBusy((b) => (b ? { ...b, done: n } : b)),
    );
    setBusy(null);
    const skipped = list.length - done;
    onMessage(`${done.toLocaleString()} requests ${action === "send_back" ? "sent back to the callers" : "cancelled"}${skipped ? `, ${skipped} skipped (already finished)` : ""}`);
    clear();
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-2">
        {STATUS_TABS.map(([value, label]) => (
          <button
            key={value}
            className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", r.filters.rstatus === value ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
            onClick={() => setFilter({ rstatus: value === "waiting" ? "" : value })}
          >
            {label}
            {value === "waiting" ? ` ${r.waiting.toLocaleString()}` : value === "mine" ? ` ${r.mine.toLocaleString()}` : ""}
          </button>
        ))}
        <Select className="ml-2 h-8 w-[180px]" value={r.filters.kind} onChange={(e) => setFilter({ kind: e.target.value })} aria-label="Request type">
          <option value="">Any request type</option>
          {RESEARCH_REQUEST_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-[170px]" value={r.filters.requester} onChange={(e) => setFilter({ requester: e.target.value })} aria-label="Requested by">
          <option value="">Any caller</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </Select>
        {message && <span className="text-[13px] text-ink-muted">{message}</span>}
        <div className="ml-auto">
          <Pager page={r.page} total={r.total} size={REQUEST_PAGE} onPage={(p) => setParams({ rpage: String(p) })} />
        </div>
      </div>

      {(count > 0 || busy) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#f0f9fb] px-6 py-2 text-[13px]">
          {busy ? (
            <Progress {...busy} />
          ) : (
            <>
              <span className="font-medium">{count.toLocaleString()} selected</span>
              {!allMatching && allOnPage && r.total > pageIds.length && (
                <button
                  className="text-link hover:underline"
                  onClick={() =>
                    start(async () => {
                      const res = await requestIdsMatching(filterParams);
                      if (!res.ok) return onMessage(res.error);
                      setAllMatching(res.data!);
                    })
                  }
                  disabled={pending}
                >
                  Select all {r.total.toLocaleString()} matching
                </button>
              )}
              <button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={clear}>
                <X className="size-3.5" /> Clear
              </button>
              <span className="mx-1 h-5 w-px bg-line" />
              <Select className="h-8 w-[190px]" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Assign requests to">
                <option value="">Take or assign…</option>
                <option value="__me__">Take them myself</option>
                {people.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                    {data.researcherIds.includes(u.id) ? " (researcher)" : ""}
                  </option>
                ))}
              </Select>
              {assignTo && (
                <Button size="sm" variant="primary" onClick={() => void assign()}>
                  Assign
                </Button>
              )}
              <span className="mx-1 h-5 w-px bg-line" />
              <Button size="sm" variant="secondary" onClick={() => setAnswering({ list: allMatching ? [] : chosen(), bulk: true })}>
                Send back with one note…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void finish("cancel")}>
                Cancel requests
              </Button>
            </>
          )}
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1000px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allMatching || allOnPage ? true : pageIds.some((id) => selected.has(id)) ? "indeterminate" : false}
                  onCheckedChange={(v) => {
                    setAllMatching(null);
                    setSelected((s) => {
                      const n = new Set(s);
                      for (const id of pageIds) {
                        if (v === true) n.add(id);
                        else n.delete(id);
                      }
                      return n;
                    });
                  }}
                  aria-label="Select this page"
                />
              </th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Needs</th>
              <th className="px-3 py-2">Caller&apos;s note</th>
              <th className="px-3 py-2">Asked by</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => {
              const checked = !!allMatching || selected.has(x.id);
              const open = x.status === "Open" || x.status === "In progress";
              return (
                <tr key={x.id} className={cn("border-b border-line align-top hover:bg-surface-hover", checked && "bg-[#f0f9fb]")}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        if (allMatching) {
                          setSelected(new Set(allMatching.filter((id) => id !== x.id)));
                          return setAllMatching(null);
                        }
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(x.id);
                          else n.delete(x.id);
                          return n;
                        });
                      }}
                      aria-label={`Select the request for ${x.company}`}
                    />
                  </td>
                  <td className="max-w-[240px] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CompanyLogo name={x.company} domain={x.domain} size={20} />
                      <Link href={`/companies/${x.companyId}`} target="_blank" className="truncate font-medium text-link hover:underline">
                        {x.company}
                      </Link>
                    </div>
                    {x.campaign && <div className="truncate pl-7 text-[12px] text-ink-subtle">{x.campaign}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{x.kind}</div>
                    {x.contact && (
                      <Link href={`/contacts/${x.contactId}`} target="_blank" className="text-[12px] text-link hover:underline">
                        {x.contact}
                      </Link>
                    )}
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    {x.note ? <span className="line-clamp-2 whitespace-pre-line text-ink-muted">{x.note}</span> : <span className="text-ink-subtle">--</span>}
                    {x.result && <div className="mt-1 line-clamp-2 rounded-[3px] bg-[#e5f8f6] px-2 py-1">{x.result}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div>{x.requestedBy ?? "--"}</div>
                    <div className="text-[12px] text-ink-subtle">{friendlyDateTime(x.createdAt)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Pill label={x.status} color={REQUEST_STATUS_COLORS[x.status]} />
                    {x.researcher && <div className="text-[12px] text-ink-subtle">{x.researcher}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {open && (
                      <div className="flex justify-end gap-1.5">
                        {x.status === "Open" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const res = await assignResearchRequests([x.id], null);
                                onMessage(res.ok ? `You're researching ${x.company}` : res.error);
                                if (res.ok) router.refresh();
                              })
                            }
                          >
                            Take it
                          </Button>
                        )}
                        <Button size="sm" variant="primary" onClick={() => setAnswering({ list: [x], bulk: false })}>
                          Send back
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!r.rows.length && <p className="py-12 text-center text-[13px] text-ink-subtle">No requests here. Callers send them from the calling queue with &ldquo;Ask research&rdquo;.</p>}
      </div>

      {answering && (
        <SendBackDialog
          requests={answering.list}
          count={answering.bulk ? count : 1}
          onClose={() => setAnswering(null)}
          onSend={async (result) => {
            if (!answering.bulk) {
              const one = answering.list[0];
              const res = await sendBackResearchRequest(one.id, result);
              if (!res.ok) return res.error;
              onMessage(`${one.company}: sent back to ${one.requestedBy ?? "the caller"}`);
              setAnswering(null);
              router.refresh();
              return null;
            }
            setAnswering(null);
            await finish("send_back", result);
            return null;
          }}
        />
      )}
    </div>
  );
}

function SendBackDialog({ requests, count, onClose, onSend }: { requests: Request[]; count: number; onClose: () => void; onSend: (result: string) => Promise<string | null> }) {
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const one = count === 1 ? requests[0] : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={one ? `Send ${one.company} back to the caller` : `Send ${count.toLocaleString()} requests back`}>
        <form
          className="space-y-3 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              if (!result.trim()) return setError("Write what you found, so the caller knows");
              setError(await onSend(result));
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          {one ? (
            <div className="rounded-[4px] bg-surface-muted px-3 py-2 text-[13px]">
              <div className="font-medium">
                {one.kind}
                {one.contact ? ` · ${one.contact}` : ""}
              </div>
              {one.note && <div className="text-ink-muted">{one.note}</div>}
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">Every selected request gets the same note, and each company moves to the top of its caller&apos;s queue.</p>
          )}
          {one && (
            <p className="text-[12px] text-ink-muted">
              Update the company and contacts first (new people, numbers, extensions) on the{" "}
              <Link href={`/companies/${one.companyId}`} target="_blank" className="text-link hover:underline">
                company record
              </Link>
              . The caller sees this note, and the company moves to the top of their queue.
            </p>
          )}
          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            rows={4}
            autoFocus
            aria-label="What you found"
            placeholder={one ? "e.g. New CTO is Jane Doe, direct line +1 813 555 0142 ext. 31, added to the company" : "e.g. Numbers verified and updated on each company"}
            className="w-full rounded-[3px] border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-link focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !result.trim()}>
              Send back
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
