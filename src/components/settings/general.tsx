"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, Label } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { updateWorkspace } from "@/lib/crm/settings-actions";
import { SettingsPage, SettingsSection } from "./settings-ui";

export function GeneralSettings({
  workspace,
  isAdmin,
  counts,
  aiConfigured,
}: {
  workspace: { name: string; defaultTimeZone: string; aiEnabled: boolean };
  isAdmin: boolean;
  counts: { contacts: number; companies: number; users: number; campaigns: number };
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(workspace);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(form) !== JSON.stringify(workspace);

  return (
    <SettingsPage title="General" description="Workspace-wide settings. Only admins can change them.">
      <div className="mb-6 grid max-w-[760px] grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ["Contacts", counts.contacts],
            ["Companies", counts.companies],
            ["Active users", counts.users],
            ["Active campaigns", counts.campaigns],
          ] as const
        ).map(([l, n]) => (
          <div key={l} className="rounded-[4px] border border-line px-4 py-3">
            <div className="text-[20px] font-medium tabular-nums">{n.toLocaleString()}</div>
            <div className="text-[12px] text-ink-muted">{l}</div>
          </div>
        ))}
      </div>

      <form
        className="max-w-[560px]"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await updateWorkspace(form);
            setMessage(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
            if (res.ok) router.refresh();
          });
        }}
      >
        <fieldset disabled={!isAdmin} className="space-y-6">
          <SettingsSection title="Workspace">
            <div className="space-y-3">
              <div>
                <Label htmlFor="ws-name">Workspace name</Label>
                <Input id="ws-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
              </div>
              <div>
                <div className="text-[12px] font-medium">Workspace time zone</div>
                <div className="text-[13px]">{form.defaultTimeZone}</div>
                <p className="mt-0.5 text-[12px] text-ink-subtle">
                  Dates, date filters, imports and task due times use this zone. Each contact&apos;s and company&apos;s own local time is still shown for calling. Changing it arrives with
                  personal preferences (build step 11).
                </p>
              </div>
            </div>
          </SettingsSection>
          <SettingsSection title="AI features">
            <label className="flex cursor-pointer items-start gap-2 text-[13px]">
              <Checkbox className="mt-0.5" checked={form.aiEnabled} onCheckedChange={(v) => setForm({ ...form, aiEnabled: v === true })} />
              <span>
                Turn on AI insights (record summaries, sentiment, suggested actions)
                <span className="block text-[12px] text-ink-subtle">
                  {aiConfigured ? "The Claude API key is set on the server." : "The AI Catch-up arrives in build step 12 and needs ANTHROPIC_API_KEY on the server."}
                </span>
              </span>
            </label>
          </SettingsSection>
        </fieldset>
        {isAdmin ? (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!dirty || pending}>
              Save
            </Button>
            {message && <span className={message.ok ? "text-[13px] text-[#00a38d]" : "text-[13px] text-danger"}>{message.text}</span>}
          </div>
        ) : (
          <p className="text-[12px] text-ink-subtle">Only admins can change these settings.</p>
        )}
      </form>
    </SettingsPage>
  );
}
