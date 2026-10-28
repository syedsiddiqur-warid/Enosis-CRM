"use client";

import { Building2, Search, UserRound, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { searchCompanies } from "@/lib/crm/actions";
import { fromLocalInput, toLocalInput } from "@/lib/crm/dates";
import { searchContacts } from "@/lib/crm/record-actions";
import { createTask, updateTask, type TaskInput } from "@/lib/crm/task-actions";
import type { PropOption, UserLite } from "@/lib/crm/types";

export interface TaskDialogOptions {
  users: UserLite[];
  types: PropOption[];
  priorities: PropOption[];
  queues: { id: string; name: string }[];
  currentUserId: string;
}

export interface EditableTask {
  id: string;
  title: string;
  body: string | null;
  taskType: string | null;
  priority: string | null;
  dueAt: string | null;
  assignee: { id: string } | null;
  queue: { id: string } | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
}

const tomorrowAt10 = () => `${toLocalInput(new Date(Date.now() + 864e5)).slice(0, 10)}T10:00`;

/** Create a task (optionally about a contact or company) or edit one. */
export function TaskDialog({ task, opts, onClose, onSaved }: { task: EditableTask | null; opts: TaskDialogOptions; onClose: () => void; onSaved: (message: string) => void }) {
  const [f, setF] = useState({
    title: task?.title ?? "",
    body: task?.body ?? "",
    taskType: task?.taskType ?? "Call",
    priority: task?.priority ?? "",
    due: task?.dueAt ? toLocalInput(task.dueAt) : tomorrowAt10(),
    assigneeId: task?.assignee?.id ?? opts.currentUserId,
    queueId: task?.queue?.id ?? "",
  });
  const [record, setRecord] = useState<{ kind: "contact" | "company"; id: string; name: string } | null>(
    task?.contact ? { kind: "contact", ...task.contact } : task?.company ? { kind: "company", ...task.company } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title={task ? "Edit task" : "Create task"} className="w-[480px]">
        <form
          className="thin-scroll flex-1 space-y-3 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const input: TaskInput = {
                title: f.title,
                body: f.body,
                taskType: f.taskType,
                priority: f.priority || null,
                dueAt: fromLocalInput(f.due),
                assigneeId: f.assigneeId || null,
                queueId: f.queueId || null,
              };
              const res = task
                ? await updateTask(task.id, input)
                : await createTask({ ...input, contactId: record?.kind === "contact" ? record.id : null, companyId: record?.kind === "company" ? record.id : null });
              if (!res.ok) return setError(res.error);
              onSaved(task ? "Task updated" : "Task created");
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div>
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" value={f.title} onChange={set("title")} autoFocus maxLength={200} placeholder="e.g. Call back after the board meeting" />
          </div>
          {!task ? (
            <RecordPicker value={record} onChange={setRecord} />
          ) : (
            record && (
              <div className="text-[13px] text-ink-muted">
                About <span className="font-medium text-ink">{record.name}</span>
              </div>
            )
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-type">Type</Label>
              <Select id="t-type" value={f.taskType} onChange={set("taskType")}>
                {opts.types.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="t-priority">Priority</Label>
              <Select id="t-priority" value={f.priority} onChange={set("priority")}>
                <option value="">None</option>
                {opts.priorities.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="t-due">Due (Asia/Dhaka)</Label>
              <Input id="t-due" type="datetime-local" value={f.due} onChange={set("due")} />
            </div>
            <div>
              <Label htmlFor="t-assignee">Assigned to</Label>
              <Select id="t-assignee" value={f.assigneeId} onChange={set("assigneeId")}>
                <option value="">Unassigned</option>
                {opts.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                    {u.id === opts.currentUserId ? " (me)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="t-queue">Queue</Label>
              <Select id="t-queue" value={f.queueId} onChange={set("queueId")}>
                <option value="">No queue</option>
                {opts.queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="t-body">Notes</Label>
            <textarea id="t-body" rows={4} value={f.body} onChange={set("body")} className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-link" />
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !f.title.trim() || !f.due}>
              {task ? "Save" : "Create task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordPicker({ value, onChange }: { value: { kind: "contact" | "company"; id: string; name: string } | null; onChange: (v: { kind: "contact" | "company"; id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ kind: "contact" | "company"; id: string; name: string; subtitle: string | null }[]>([]);
  useEffect(() => {
    if (value || q.trim().length < 2) return setResults([]);
    let live = true;
    const t = setTimeout(async () => {
      const [contacts, companies] = await Promise.all([searchContacts(q), searchCompanies(q)]);
      if (!live) return;
      setResults([
        ...contacts.slice(0, 6).map((c) => ({ kind: "contact" as const, id: c.id, name: c.name, subtitle: c.subtitle })),
        ...companies.slice(0, 6).map((c) => ({ kind: "company" as const, id: c.id, name: c.name, subtitle: c.domain })),
      ]);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, value]);

  if (value) {
    return (
      <div>
        <div className="mb-1 text-[12px] font-medium">About</div>
        <div className="flex items-center gap-2 rounded-[3px] border border-line px-2.5 py-1.5 text-[13px]">
          {value.kind === "contact" ? <UserRound className="size-4 text-ink-subtle" /> : <Building2 className="size-4 text-ink-subtle" />}
          <span className="flex-1">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove" className="rounded p-0.5 hover:bg-surface-hover">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor="t-record">About a contact or company (optional)</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <Input id="t-record" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts and companies" className="pl-8" />
      </div>
      {results.length > 0 && (
        <ul className="mt-1 max-h-[200px] overflow-y-auto rounded-[3px] border border-line">
          {results.map((r) => (
            <li key={`${r.kind}${r.id}`}>
              <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-hover" onClick={() => onChange({ kind: r.kind, id: r.id, name: r.name })}>
                {r.kind === "contact" ? <UserRound className="size-4 shrink-0 text-ink-subtle" /> : <Building2 className="size-4 shrink-0 text-ink-subtle" />}
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.subtitle && <span className="truncate text-[12px] text-ink-subtle">{r.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
