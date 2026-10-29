"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { pageNumbers } from "@/components/index/index-page";
import { LocalTime, Pill } from "@/components/index/values";
import { Button, Input, Select } from "@/components/ui/button";
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/overlays";
import { friendlyDateTime, fromLocalInput } from "@/lib/crm/dates";
import {
  assignTasks,
  createTaskQueue,
  deleteTaskQueue,
  deleteTasks,
  rescheduleTasks,
  restoreDueDates,
  setTasksDone,
  setTasksQueue,
  updateTask,
} from "@/lib/crm/task-actions";
import type { TaskItem, TasksData, TaskTab } from "@/lib/crm/tasks";
import { cn } from "@/lib/utils";
import { TaskDialog } from "./task-dialog";

type Toast = { message: string; undo?: () => Promise<unknown> };
type Status = TaskItem["taskStatus"];

const TAB_LABEL: Record<TaskTab, string> = {
  today: "Due today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  open: "All open",
  completed: "Completed",
};
const STATUS_LABEL: Record<Status, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  COMPLETED: "Completed",
};
const STATUS_COLOR: Record<Status, string> = {
  NOT_STARTED: "#cbd6e2",
  IN_PROGRESS: "#f5c26b",
  WAITING: "#7c98b6",
  COMPLETED: "#00bda5",
};

export function TasksPage({ data }: { data: TasksData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ task: TaskItem | null } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [q, setQ] = useState(data.filters.q);
  const ids = [...selected];
  const now = Date.now();
  const priorityColor = (p: string | null) =>
    data.priorities.find((o) => o.value === p)?.color;

  useEffect(() => setSelected(new Set()), [data.tasks]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    startTransition(() =>
      router.replace(`${pathname}?${p.toString()}`, { scroll: false }),
    );
  };
  useEffect(() => {
    if (q === data.filters.q) return;
    const t = setTimeout(() => setParams({ q: q || null, page: null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    message: string,
    undo?: () => Promise<unknown>,
  ) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok)
        return setToast({ message: res.error ?? "Something went wrong" });
      setToast({ message, undo });
      router.refresh();
    });
  const reschedule = (
    taskIds: string[],
    to: { at?: string; days?: number },
    label: string,
  ) =>
    startTransition(async () => {
      const res = await rescheduleTasks(taskIds, to);
      if (!res.ok) return setToast({ message: res.error });
      const prev = res.data!.previous;
      setToast({
        message: `${taskIds.length === 1 ? "Task" : `${taskIds.length} tasks`} moved to ${label}`,
        undo: () => restoreDueDates(prev),
      });
      router.refresh();
    });

  const startQuery = new URLSearchParams({
    tab: data.tab === "completed" ? "open" : data.tab,
    ...Object.fromEntries(Object.entries(data.filters).filter(([, v]) => v)),
  }).toString();
  const startCount =
    data.tab === "completed" ? data.counts.open : data.counts[data.tab];
  const allSelected =
    data.tasks.length > 0 && data.tasks.every((t) => selected.has(t.id));
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const opts = {
    users: data.users,
    types: data.types,
    priorities: data.priorities,
    queues: data.queues,
    currentUserId: data.currentUserId,
  };

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      <div className="flex flex-wrap items-center gap-2 px-6 pb-2 pt-4">
        <h1 className="text-[22px] font-medium">Tasks</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setDialog({ task: null })}>
            <Plus /> Create task
          </Button>
          <Button variant="primary" asChild aria-disabled={!startCount}>
            <Link
              href={`/tasks/start?${startQuery}`}
              className={cn(!startCount && "pointer-events-none opacity-50")}
            >
              <Play /> Start {startCount} task{startCount === 1 ? "" : "s"}
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex items-end gap-1 border-b border-line px-6">
        {(Object.keys(TAB_LABEL) as TaskTab[]).map((t) => (
          <button
            key={t}
            onClick={() =>
              setParams({ tab: t === "today" ? null : t, page: null })
            }
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-t-[4px] border border-b-0 px-3 text-[13px]",
              data.tab === t
                ? "-mb-px border-line bg-surface font-medium"
                : "border-transparent text-ink-muted hover:bg-surface-hover",
              t === "overdue" &&
                data.counts.overdue > 0 &&
                data.tab !== t &&
                "text-danger",
            )}
          >
            {TAB_LABEL[t]}{" "}
            <span className="text-ink-subtle">({data.counts[t]})</span>
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 bg-[#e5f5f8] px-6 py-2.5 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          {data.tab !== "completed" ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-link"
              onClick={() =>
                run(
                  () => setTasksDone(ids, true),
                  `Completed ${ids.length}`,
                  () => setTasksDone(ids, false),
                )
              }
            >
              <Check /> Complete
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-link"
              onClick={() =>
                run(() => setTasksDone(ids, false), `Reopened ${ids.length}`)
              }
            >
              Reopen
            </Button>
          )}
          <RescheduleMenu onPick={(to, label) => reschedule(ids, to, label)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="text-link">
                Assign <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {data.users.map((u) => (
                <DropdownMenuItem
                  key={u.id}
                  onSelect={() =>
                    run(
                      () => assignTasks(ids, u.id),
                      `Assigned to ${u.name ?? u.email}`,
                    )
                  }
                >
                  {u.name ?? u.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="text-link">
                Queue <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {data.queues.map((qq) => (
                <DropdownMenuItem
                  key={qq.id}
                  onSelect={() =>
                    run(() => setTasksQueue(ids, qq.id), `Added to ${qq.name}`)
                  }
                >
                  {qq.name}
                </DropdownMenuItem>
              ))}
              {data.queues.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() =>
                  run(() => setTasksQueue(ids, null), "Removed from queue")
                }
              >
                No queue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() =>
              run(
                () => deleteTasks(ids),
                `Deleted ${ids.length}`,
                () => deleteTasks(ids, true),
              )
            }
          >
            <Trash2 /> Delete
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <div className="relative w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks or records"
              className="pl-8"
              aria-label="Search tasks"
            />
          </div>
          <Select
            className="w-[160px]"
            value={data.filters.assignee}
            onChange={(e) =>
              setParams({
                assignee: e.target.value === "me" ? null : e.target.value,
                page: null,
              })
            }
            aria-label="Assigned to"
          >
            <option value="me">Assigned to me</option>
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {data.users
              .filter((u) => u.id !== data.currentUserId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
          </Select>
          <Select
            className="w-[130px]"
            value={data.filters.type}
            onChange={(e) =>
              setParams({ type: e.target.value || null, page: null })
            }
            aria-label="Task type"
          >
            <option value="">All types</option>
            {data.types.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            className="w-[130px]"
            value={data.filters.priority}
            onChange={(e) =>
              setParams({ priority: e.target.value || null, page: null })
            }
            aria-label="Priority"
          >
            <option value="">Any priority</option>
            {data.priorities.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            className="w-[150px]"
            value={data.filters.queue}
            onChange={(e) =>
              setParams({ queue: e.target.value || null, page: null })
            }
            aria-label="Queue"
          >
            <option value="">All queues</option>
            <option value="none">No queue</option>
            {data.queues.map((qq) => (
              <option key={qq.id} value={qq.id}>
                {qq.name}
              </option>
            ))}
          </Select>
          <QueueManager
            data={data}
            onDone={(m) => (setToast({ message: m }), router.refresh())}
          />
          <div className="ml-auto flex rounded-[3px] border border-line">
            {(
              [
                ["list", List, "List"],
                ["board", Columns3, "Board"],
              ] as const
            ).map(([v, Icon, label]) => (
              <button
                key={v}
                onClick={() =>
                  setParams({ view: v === "list" ? null : v, page: null })
                }
                aria-pressed={data.view === v}
                aria-label={`${label} view`}
                className={cn(
                  "flex h-8 items-center gap-1 px-2.5 text-[13px]",
                  data.view === v ? "bg-[#e5f5f8]" : "hover:bg-surface-hover",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.view === "list" ? (
        <>
          <div className="thin-scroll min-h-0 flex-1 overflow-auto border-t border-line">
            <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="h-10 w-10 border-b border-line px-3">
                    <Checkbox
                      checked={
                        allSelected
                          ? true
                          : selected.size
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(data.tasks.map((t) => t.id)),
                        )
                      }
                      aria-label="Select all"
                    />
                  </th>
                  <th className="w-10 border-b border-line" />
                  {[
                    "Task",
                    "About",
                    "Type",
                    "Priority",
                    "Status",
                    data.tab === "completed" ? "Completed" : "Due",
                    "Assigned to",
                    "Queue",
                  ].map((h) => (
                    <th
                      key={h}
                      className="border-b border-line px-3 font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => {
                  const overdue =
                    t.taskStatus !== "COMPLETED" &&
                    t.dueAt &&
                    new Date(t.dueAt).getTime() < now;
                  return (
                    <tr
                      key={t.id}
                      className={cn(
                        "hover:bg-[#f5f8fa]",
                        selected.has(t.id) && "bg-[#f0f9fb]",
                      )}
                    >
                      <td className="border-b border-line px-3">
                        <Checkbox
                          checked={selected.has(t.id)}
                          onCheckedChange={(v) => {
                            const n = new Set(selected);
                            if (v) n.add(t.id);
                            else n.delete(t.id);
                            setSelected(n);
                          }}
                          aria-label={`Select ${t.title}`}
                        />
                      </td>
                      <td className="border-b border-line">
                        <DoneButton
                          task={t}
                          onToggle={(done) =>
                            run(
                              () => setTasksDone([t.id], done),
                              done ? "Task completed" : "Task reopened",
                              () => setTasksDone([t.id], !done),
                            )
                          }
                        />
                      </td>
                      <td className="h-11 max-w-[320px] border-b border-line px-3">
                        <button
                          className={cn(
                            "block max-w-full truncate text-left font-medium text-link hover:underline",
                            t.taskStatus === "COMPLETED" &&
                              "text-ink-muted line-through",
                          )}
                          onClick={() => setDialog({ task: t })}
                        >
                          {t.title}
                        </button>
                        {t.body && (
                          <div className="truncate text-[12px] text-ink-subtle">
                            {t.body}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[240px] border-b border-line px-3">
                        <RecordLinks task={t} />
                      </td>
                      <td className="border-b border-line px-3 text-ink-muted">
                        {t.taskType ?? "--"}
                      </td>
                      <td className="border-b border-line px-3">
                        {t.priority ? (
                          <Pill
                            label={t.priority}
                            color={priorityColor(t.priority)}
                          />
                        ) : (
                          <span className="text-ink-subtle">--</span>
                        )}
                      </td>
                      <td className="border-b border-line px-3">
                        <Select
                          className="h-7 w-[130px] text-[12px]"
                          value={t.taskStatus}
                          onChange={(e) =>
                            run(
                              () =>
                                updateTask(t.id, {
                                  taskStatus: e.target.value as Status,
                                }),
                              `Status: ${STATUS_LABEL[e.target.value as Status]}`,
                            )
                          }
                          aria-label={`Status of ${t.title}`}
                        >
                          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap border-b border-line px-3",
                          overdue
                            ? "font-medium text-danger"
                            : "text-ink-muted",
                        )}
                      >
                        {data.tab === "completed"
                          ? friendlyDateTime(t.completedAt)
                          : t.dueAt
                            ? friendlyDateTime(t.dueAt)
                            : "--"}
                        {data.tab !== "completed" &&
                          t.taskStatus !== "COMPLETED" && (
                            <RescheduleMenu
                              compact
                              onPick={(to, label) =>
                                reschedule([t.id], to, label)
                              }
                            />
                          )}
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">
                        {t.assignee?.name ?? "Unassigned"}
                      </td>
                      <td className="border-b border-line px-3 text-ink-muted">
                        {t.queue?.name ?? "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data.tasks.length && <EmptyState tab={data.tab} />}
          </div>
          <div className="flex items-center gap-1 border-t border-line px-6 py-2.5 text-[13px]">
            <span className="text-ink-muted">
              {data.total} task{data.total === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={data.page <= 1}
                onClick={() => setParams({ page: String(data.page - 1) })}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              {pageNumbers(data.page, pageCount).map((p, i) =>
                p === null ? (
                  <span key={i} className="px-1 text-ink-subtle">
                    …
                  </span>
                ) : (
                  <Button
                    key={i}
                    size="sm"
                    variant={p === data.page ? "outline" : "ghost"}
                    onClick={() =>
                      setParams({ page: p === 1 ? null : String(p) })
                    }
                  >
                    {p}
                  </Button>
                ),
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={data.page >= pageCount}
                onClick={() => setParams({ page: String(data.page + 1) })}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <Board
          data={data}
          onMove={(t, s) =>
            run(
              () => updateTask(t.id, { taskStatus: s }),
              `${t.title}: ${STATUS_LABEL[s]}`,
            )
          }
          onOpen={(t) => setDialog({ task: t })}
        />
      )}

      {dialog && (
        <TaskDialog
          task={dialog.task}
          opts={opts}
          onClose={() => setDialog(null)}
          onSaved={(m) => {
            setDialog(null);
            setToast({ message: m });
            router.refresh();
          }}
        />
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg"
        >
          {toast.message}
          {toast.undo && (
            <button
              className="font-medium underline"
              onClick={async () => {
                await toast.undo!();
                setToast({ message: "Undone" });
                router.refresh();
              }}
            >
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function DoneButton({
  task,
  onToggle,
}: {
  task: TaskItem;
  onToggle: (done: boolean) => void;
}) {
  const done = task.taskStatus === "COMPLETED";
  return (
    <button
      onClick={() => onToggle(!done)}
      aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
      className={cn(
        "ml-1 flex size-5 items-center justify-center rounded-full border-2",
        done
          ? "border-[#00bda5] bg-[#00bda5] text-white"
          : "border-line-strong hover:border-[#00bda5]",
      )}
    >
      {done && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

function RecordLinks({ task: t }: { task: TaskItem }) {
  if (!t.contact && !t.company)
    return <span className="text-ink-subtle">--</span>;
  return (
    <div className="min-w-0">
      {t.contact && (
        <Link
          href={`/contacts/${t.contact.id}`}
          className="block truncate text-link hover:underline"
        >
          {t.contact.name}
        </Link>
      )}
      {t.company && (
        <Link
          href={`/companies/${t.company.id}`}
          className={cn(
            "block truncate hover:underline",
            t.contact ? "text-[12px] text-ink-muted" : "text-link",
          )}
        >
          {t.company.name}
        </Link>
      )}
      {t.timeZone && (
        <div className="text-[11px] text-ink-subtle">
          <LocalTime tz={t.timeZone} suffix="their time" />
        </div>
      )}
    </div>
  );
}

export function RescheduleMenu({
  onPick,
  compact,
}: {
  onPick: (to: { at?: string; days?: number }, label: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <button
            className="ml-1 text-[11px] text-link opacity-60 hover:underline hover:opacity-100"
            aria-label="Reschedule"
          >
            Move
          </button>
        ) : (
          <Button size="sm" variant="ghost" className="text-link">
            Reschedule <ChevronDown />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[230px] p-2">
        {(
          [
            [1, "+1 day"],
            [2, "+2 days"],
            [7, "+1 week"],
          ] as const
        ).map(([d, l]) => (
          <button
            key={d}
            className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-hover"
            onClick={() => {
              setOpen(false);
              onPick({ days: d }, l);
            }}
          >
            {l}
          </button>
        ))}
        <div className="mt-1 flex gap-1 border-t border-line pt-2">
          <Input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="h-8"
            aria-label="New due date"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!at}
            onClick={() => {
              setOpen(false);
              onPick(
                { at: fromLocalInput(at) },
                friendlyDateTime(fromLocalInput(at)),
              );
            }}
          >
            Set
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Board({
  data,
  onMove,
  onOpen,
}: {
  data: TasksData;
  onMove: (t: TaskItem, s: Status) => void;
  onOpen: (t: TaskItem) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const now = Date.now();
  const columns: Status[] =
    data.tab === "completed"
      ? ["COMPLETED"]
      : ["NOT_STARTED", "IN_PROGRESS", "WAITING", "COMPLETED"];
  return (
    <div className="thin-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto border-t border-line bg-surface-muted p-3">
      {columns.map((s) => {
        const items = data.tasks.filter((t) => t.taskStatus === s);
        return (
          <section
            key={s}
            aria-label={STATUS_LABEL[s]}
            onDragOver={(e) => (e.preventDefault(), setOver(s))}
            onDragLeave={() => setOver((o) => (o === s ? null : o))}
            onDrop={() => {
              const t = data.tasks.find((x) => x.id === dragging);
              setDragging(null);
              setOver(null);
              if (t && t.taskStatus !== s) onMove(t, s);
            }}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-[4px] border border-line bg-surface",
              over === s && dragging && "border-link ring-2 ring-link/30",
            )}
          >
            <div
              className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold"
              style={{ borderTop: `3px solid ${STATUS_COLOR[s]}` }}
            >
              {STATUS_LABEL[s]}{" "}
              <span className="font-normal text-ink-subtle">
                {items.length}
              </span>
            </div>
            <div className="thin-scroll min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((t) => {
                const overdue =
                  s !== "COMPLETED" &&
                  t.dueAt &&
                  new Date(t.dueAt).getTime() < now;
                return (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={() => setDragging(t.id)}
                    onDragEnd={() => (setDragging(null), setOver(null))}
                    className={cn(
                      "cursor-grab rounded-[4px] border border-line bg-surface p-2.5 text-[13px] shadow-sm hover:border-line-strong",
                      dragging === t.id && "opacity-50",
                    )}
                  >
                    <button
                      className="block text-left font-medium text-link hover:underline"
                      onClick={() => onOpen(t)}
                    >
                      {t.title}
                    </button>
                    <div className="mt-1 text-[12px]">
                      <RecordLinks task={t} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                      {t.taskType && <Pill label={t.taskType} />}
                      {t.priority && (
                        <Pill
                          label={t.priority}
                          color={
                            data.priorities.find((o) => o.value === t.priority)
                              ?.color
                          }
                        />
                      )}
                      <span
                        className={cn(
                          "ml-auto",
                          overdue
                            ? "font-medium text-danger"
                            : "text-ink-subtle",
                        )}
                      >
                        {t.dueAt ? friendlyDateTime(t.dueAt) : ""}
                      </span>
                    </div>
                  </article>
                );
              })}
              {!items.length && (
                <p className="px-1 py-4 text-center text-[12px] text-ink-subtle">
                  Drop tasks here
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function QueueManager({
  data,
  onDone,
}: {
  data: TasksData;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          Manage queues
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-3 text-[13px]">
        <div className="mb-2 font-semibold">Task queues</div>
        <p className="mb-2 text-[12px] text-ink-muted">
          Group tasks to work through together, e.g. &ldquo;Monday
          callbacks&rdquo;. Add tasks from the bulk bar, then filter by queue
          and press Start.
        </p>
        <ul className="mb-2 space-y-1">
          {data.queues.map((q) => (
            <li key={q.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{q.name}</span>
              <span className="text-[11px] text-ink-subtle">
                {q.shared ? "shared" : "personal"}
              </span>
              {(q.ownerId === data.currentUserId || data.isManager) && (
                <button
                  className="rounded p-1 text-ink-subtle hover:bg-surface-hover"
                  aria-label={`Delete queue ${q.name}`}
                  onClick={async () => {
                    const res = await deleteTaskQueue(q.id);
                    if (!res.ok) return setError(res.error);
                    onDone(`Deleted queue ${q.name}`);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {!data.queues.length && (
            <li className="text-ink-subtle">No queues yet</li>
          )}
        </ul>
        <form
          className="space-y-2 border-t border-line pt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await createTaskQueue(name, shared);
            if (!res.ok) return setError(res.error);
            setName("");
            onDone(`Created queue ${name.trim()}`);
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New queue name"
            aria-label="New queue name"
            maxLength={80}
          />
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              className="accent-[var(--link)]"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            Shared with everyone
          </label>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!name.trim()}
          >
            <Plus /> Create queue
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({ tab }: { tab: TaskTab }) {
  const text: Record<TaskTab, string> = {
    today: "Nothing due today.",
    overdue: "No overdue tasks. Nice.",
    upcoming: "No upcoming tasks.",
    open: "No open tasks.",
    completed: "No completed tasks yet.",
  };
  return (
    <div className="py-14 text-center">
      <div className="mb-1 text-[16px] font-medium">{text[tab]}</div>
      <div className="text-[13px] text-ink-muted">
        Tasks come from follow-up rules after calls, from record pages, from the
        bulk bar on Contacts and Companies, or Create task above.
      </div>
    </div>
  );
}
