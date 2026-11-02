"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label } from "@/components/ui/button";
import { changeMyPassword } from "@/lib/crm/settings-actions";

export function ChangePassword({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setMessage(null);
      if (form.next !== form.confirm) return setMessage({ ok: false, text: "The two new passwords don't match" });
      const res = await changeMyPassword(form.current, form.next);
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      setForm({ current: "", next: "", confirm: "" });
      setMessage({ ok: true, text: "Password changed. Use the new one next time you sign in." });
    });

  return (
    <div className="thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-8 py-6">
      <h1 className="text-[22px] font-medium">My account</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Signed in as {email}</p>
      <form
        className="mt-6 max-w-[360px] space-y-3"
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 className="text-[15px] font-semibold">Change password</h2>
        {/* Lets password managers tie the new password to this account */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        {hasPassword && (
          <div>
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />
          </div>
        )}
        <div>
          <Label htmlFor="pw-next">New password</Label>
          <Input id="pw-next" type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required minLength={10} />
          <p className="mt-1 text-[12px] text-ink-subtle">10+ characters, with letters and at least one number.</p>
        </div>
        <div>
          <Label htmlFor="pw-confirm">Repeat new password</Label>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required minLength={10} />
        </div>
        {message && <p className={message.ok ? "rounded-[3px] bg-[#e5f8f6] px-3 py-2 text-[13px]" : "rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger"}>{message.text}</p>}
        <Button type="submit" variant="primary" disabled={pending}>
          Change password
        </Button>
      </form>
    </div>
  );
}
