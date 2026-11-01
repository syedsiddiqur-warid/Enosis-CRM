"use client";

import { useState } from "react";
import { Button, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";

/** Ask why before closing something out: a deal lost, a lead disqualified. */
export function ReasonDialog({
  title,
  intro,
  reasons,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  intro: string;
  reasons: readonly string[];
  confirm: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title={title} className="w-[420px]">
        <form
          className="space-y-3 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) onConfirm(reason);
          }}
        >
          <p className="text-[13px] text-ink-muted">{intro}</p>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
              <option value="">Pick a reason</option>
              {reasons.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!reason}>
              {confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
