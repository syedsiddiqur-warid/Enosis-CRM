"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { deleteFollowUpRule, saveFollowUpRule, updateOptionList } from "@/lib/crm/settings-actions";
import type { PropOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { OptionsEditor } from "./options-editor";
import { SettingsPage, SettingsSection } from "./settings-ui";

type List = { key: string; label: string; options: PropOption[] };
type Rule = { id: string; callResult: string; taskTitle: string; taskType: string; dueInDays: number; isActive: boolean };

const LIST_HELP: Record<string, string> = {
  callResult: "Outcome buttons in the call logger and calling queue (keys 1–9, 0 follow this order)",
  callPath: "How the call reached the person",
  gatekeeperType: "Who blocked the call",
  taskType: "Task types",
  taskPriority: "Task priorities",
  meetingType: "Meeting types",
  meetingOutcome: "Meeting outcomes",
  phoneType: "Phone number types",
  phoneStatus: "Phone number statuses",
  signalType: "Buying signal types",
  signalStrength: "Buying signal strengths",
  signalSource: "Where buying signals come from",
  campaignType: "Campaign types",
  campaignMemberStatus: "A company's outcome in a campaign",
};

export function ListsSettings({ lists, rules, canEdit }: { lists: List[]; rules: Rule[]; canEdit: boolean }) {
  const [active, setActive] = useState(lists.find((l) => l.key === "callResult")?.key ?? lists[0]?.key);
  const list = lists.find((l) => l.key === active);
  return (
    <SettingsPage
      title="Dropdown lists & follow-ups"
      description="Values for calls, tasks, meetings, phone numbers, buying signals and campaigns. Contact and company dropdowns (lead status, journey stages, industries…) are edited on their property in Properties."
    >
      <SettingsSection title="Dropdown lists">
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,560px)]">
          <ul className="rounded-[4px] border border-line py-1">
            {lists.map((l) => (
              <li key={l.key}>
                <button
                  onClick={() => setActive(l.key)}
                  className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover", active === l.key && "bg-[#e5f5f8] font-medium")}
                >
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  <span className="text-[12px] text-ink-subtle">{l.options.filter((o) => !o.archived).length}</span>
                </button>
              </li>
            ))}
          </ul>
          {list && <ListEditor key={list.key} list={list} canEdit={canEdit} />}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Follow-up rules"
        description="After a call with this outcome, the call logger and calling queue suggest (and the queue creates) a follow-up task. In the calling queue it's due on the company's working morning."
      >
        <FollowUpRules rules={rules} outcomes={lists.find((l) => l.key === "callResult")?.options ?? []} taskTypes={lists.find((l) => l.key === "taskType")?.options ?? []} canEdit={canEdit} />
      </SettingsSection>
    </SettingsPage>
  );
}

function ListEditor({ list, canEdit }: { list: List; canEdit: boolean }) {
  const router = useRouter();
  const [options, setOptions] = useState(list.options);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(options) !== JSON.stringify(list.options);
  return (
    <div>
      <h3 className="text-[14px] font-medium">{list.label}</h3>
      <p className="mb-2 text-[12px] text-ink-muted">{LIST_HELP[list.key] ?? ""}</p>
      <OptionsEditor options={options} saved={new Set(list.options.map((o) => o.value))} onChange={setOptions} disabled={!canEdit} />
      {canEdit && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const res = await updateOptionList(list.key, options);
                setMessage(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
                if (res.ok) router.refresh();
              })
            }
          >
            Save
          </Button>
          <Button variant="ghost" disabled={!dirty} onClick={() => (setOptions(list.options), setMessage(null))}>
            Discard
          </Button>
          {message && <span className={message.ok ? "text-[13px] text-[#00a38d]" : "text-[13px] text-danger"}>{message.text}</span>}
        </div>
      )}
    </div>
  );
}

function FollowUpRules({ rules, outcomes, taskTypes, canEdit }: { rules: Rule[]; outcomes: PropOption[]; taskTypes: PropOption[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blank = { callResult: "", taskTitle: "", taskType: "Call", dueInDays: 1, isActive: true };
  const [draft, setDraft] = useState(blank);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong");
      after?.();
      router.refresh();
    });
  const save = (r: Rule, patch: Partial<Rule>) => run(() => saveFollowUpRule(r.id, { ...r, ...patch }));

  return (
    <div className="max-w-[900px]">
      {error && <p className="mb-2 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="thin-scroll overflow-x-auto rounded-[4px] border border-line">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2">When the call outcome is</th>
              <th className="px-3 py-2">Create task</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Due in (days)</th>
              <th className="px-3 py-2">On</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={cn("border-t border-line", !r.isActive && "opacity-60")}>
                <td className="px-3 py-1.5">
                  <Select className="h-8" value={r.callResult} disabled={!canEdit || pending} onChange={(e) => save(r, { callResult: e.target.value })} aria-label="Call outcome">
                    {outcomes.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    className="h-8"
                    defaultValue={r.taskTitle}
                    disabled={!canEdit || pending}
                    onBlur={(e) => e.target.value.trim() !== r.taskTitle && save(r, { taskTitle: e.target.value })}
                    aria-label="Task title"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Select className="h-8 w-[110px]" value={r.taskType} disabled={!canEdit || pending} onChange={(e) => save(r, { taskType: e.target.value })} aria-label="Task type">
                    {taskTypes.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    className="h-8 w-20"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={r.dueInDays}
                    disabled={!canEdit || pending}
                    onBlur={(e) => Number(e.target.value) !== r.dueInDays && save(r, { dueInDays: Number(e.target.value) })}
                    aria-label="Due in days"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Checkbox checked={r.isActive} disabled={!canEdit || pending} onCheckedChange={(v) => save(r, { isActive: v === true })} aria-label="Rule is on" />
                </td>
                <td className="px-3 py-1.5 text-right">
                  {canEdit && (
                    <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteFollowUpRule(r.id))} aria-label="Delete rule">
                      <Trash2 />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {canEdit && (
              <tr className="border-t border-line bg-surface-muted">
                <td className="px-3 py-1.5">
                  <Select className="h-8" value={draft.callResult} onChange={(e) => setDraft({ ...draft, callResult: e.target.value })} aria-label="New rule call outcome">
                    <option value="">Choose an outcome</option>
                    {outcomes
                      .filter((o) => !o.archived)
                      .map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </Select>
                </td>
                <td className="px-3 py-1.5">
                  <Input className="h-8" value={draft.taskTitle} onChange={(e) => setDraft({ ...draft, taskTitle: e.target.value })} placeholder="e.g. Call again" aria-label="New rule task title" />
                </td>
                <td className="px-3 py-1.5">
                  <Select className="h-8 w-[110px]" value={draft.taskType} onChange={(e) => setDraft({ ...draft, taskType: e.target.value })} aria-label="New rule task type">
                    {taskTypes.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-1.5">
                  <Input className="h-8 w-20" type="number" min={0} max={365} value={draft.dueInDays} onChange={(e) => setDraft({ ...draft, dueInDays: Number(e.target.value) })} aria-label="New rule due in days" />
                </td>
                <td colSpan={2} className="px-3 py-1.5 text-right">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !draft.callResult || !draft.taskTitle.trim()}
                    onClick={() =>
                      run(
                        () => saveFollowUpRule(null, draft),
                        () => setDraft(blank),
                      )
                    }
                  >
                    <Plus /> Add rule
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
