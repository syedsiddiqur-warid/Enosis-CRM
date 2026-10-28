"use client";

import { SquareCheckBig } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { fromLocalInput, toLocalInput } from "@/lib/crm/dates";
import { createTasksFor } from "@/lib/crm/task-actions";
import type { CrmObject, PropOption, UserLite } from "@/lib/crm/types";

/** Bulk bar "Create tasks": one task per selected contact or company. */
export function CreateTasksButton({
  object,
  ids,
  users,
  types,
  priorities,
  currentUserId,
  onDone,
}: {
  object: CrmObject;
  ids: string[];
  users: UserLite[];
  types: PropOption[];
  priorities: PropOption[];
  currentUserId: string;
  onDone: (message: string) => void;
}) {
  const blank = () => ({ title: "", taskType: "Call", priority: "", due: `${toLocalInput(new Date(Date.now() + 864e5)).slice(0, 10)}T10:00`, assigneeId: currentUserId });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && (setF(blank()), setError(null)))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <SquareCheckBig /> Create tasks
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0">
        <form
          className="space-y-2.5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createTasksFor(object, ids, {
                title: f.title,
                taskType: f.taskType,
                priority: f.priority || null,
                dueAt: fromLocalInput(f.due),
                assigneeId: f.assigneeId || null,
              });
              if (!res.ok) return setError(res.error);
              setOpen(false);
              onDone(`Created ${res.data!.created} task${res.data!.created === 1 ? "" : "s"}`);
            });
          }}
        >
          <div className="text-[12px] font-semibold">
            One task for each of the {ids.length} selected {object === "CONTACT" ? "contacts" : "companies"}
          </div>
          <Input value={f.title} onChange={set("title")} placeholder="Task title, e.g. Call about Q1 budget" aria-label="Task title" autoFocus maxLength={200} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={f.taskType} onChange={set("taskType")} aria-label="Task type">
              {types.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select value={f.priority} onChange={set("priority")} aria-label="Priority">
              <option value="">No priority</option>
              {priorities.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bulk-due" className="text-[11px] text-ink-muted">
              Due (Asia/Dhaka)
            </Label>
            <Input id="bulk-due" type="datetime-local" value={f.due} onChange={set("due")} />
          </div>
          <Select value={f.assigneeId} onChange={set("assigneeId")} aria-label="Assigned to">
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
                {u.id === currentUserId ? " (me)" : ""}
              </option>
            ))}
          </Select>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <Button type="submit" size="sm" variant="primary" className="w-full" disabled={pending || !f.title.trim()}>
            Create {ids.length} task{ids.length === 1 ? "" : "s"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
