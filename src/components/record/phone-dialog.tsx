"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { savePhoneNumber, type PhoneInput } from "@/lib/crm/phone-actions";
import { useRecord } from "./record-context";

/** Add or edit a phone number on the current record. */
export function PhoneDialog({ editing, onClose }: { editing: (PhoneInput & { id: string }) | null; onClose: () => void }) {
  const { data, toast, refresh } = useRecord();
  const [f, setF] = useState<PhoneInput>(
    editing ?? { number: "", extension: "", type: data.object === "CONTACT" ? "Direct" : "Main", ivrPath: "", status: "Unknown", notes: "", contactId: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PhoneInput>(k: K, v: PhoneInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const { phoneType, phoneStatus } = data.options;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={editing ? "Edit phone number" : "Add phone number"}>
        <form
          className="space-y-3 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await savePhoneNumber(data.object, data.id, editing?.id ?? null, f);
              if (!res.ok) return setError(res.error);
              toast({ message: editing ? "Phone number updated" : "Phone number added" });
              refresh();
              onClose();
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div>
              <Label htmlFor="ph-number">Number</Label>
              <Input id="ph-number" value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="+1 813 555 0100" autoFocus />
            </div>
            <div>
              <Label htmlFor="ph-ext">Extension</Label>
              <Input id="ph-ext" value={f.extension ?? ""} onChange={(e) => set("extension", e.target.value)} placeholder="204" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ph-type">Type</Label>
              <Select id="ph-type" value={f.type} onChange={(e) => set("type", e.target.value)}>
                {phoneType.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ph-status">Status</Label>
              <Select id="ph-status" value={f.status} onChange={(e) => set("status", e.target.value)}>
                {phoneStatus.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="ph-ivr">IVR path</Label>
            <Input id="ph-ivr" value={f.ivrPath ?? ""} onChange={(e) => set("ivrPath", e.target.value)} placeholder="DBND 9, Sales 1, OPT 0" />
            <p className="mt-1 text-[12px] text-ink-subtle">The menu steps to reach a person, in order. Shown to callers next to the number.</p>
          </div>
          {data.object === "COMPANY" && data.contacts.length > 0 && (
            <div>
              <Label htmlFor="ph-contact">Whose line</Label>
              <Select id="ph-contact" value={f.contactId ?? ""} onChange={(e) => set("contactId", e.target.value || null)}>
                <option value="">Company line</option>
                {data.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.jobTitle ? ` – ${c.jobTitle}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="ph-notes">Notes</Label>
            <Input id="ph-notes" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. Best before 10 AM, ask for Adam" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !f.number.trim()}>
              {editing ? "Save" : "Add number"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
