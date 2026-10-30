"use client";

// Fix-ups a caller makes mid-call (company details, people, numbers and extensions) and research requests.
import { CheckCircle2, FlaskConical, Hourglass } from "lucide-react";
import { useState, useTransition } from "react";
import { Pill } from "@/components/index/values";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { createContact, updateProperty } from "@/lib/crm/actions";
import type { QueueCompany, QueueData } from "@/lib/crm/calling-queue-loader";
import { friendlyDateTime } from "@/lib/crm/dates";
import { INDUSTRIES } from "@/lib/crm/defaults";
import { COUNTRIES, regionsFor, timeZoneFor } from "@/lib/crm/geo";
import { savePhoneNumber, type PhoneInput } from "@/lib/crm/phone-actions";
import { REQUEST_STATUS_COLORS, RESEARCH_REQUEST_KINDS } from "@/lib/crm/research";
import { cancelResearchRequest, createResearchRequest, markResearchSeen } from "@/lib/crm/research-request-actions";
import { cn } from "@/lib/utils";

type Done = (message: string) => void;
type Contact = QueueCompany["contacts"][number];
type PhoneRow = QueueCompany["phones"][number];

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null;
}

function Actions({ onClose, pending, label, disabled }: { onClose: () => void; pending: boolean; label: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={pending || disabled}>
        {label}
      </Button>
    </div>
  );
}

/** Save each changed field in order; stops at the first error. */
async function saveFields(object: "COMPANY" | "CONTACT", id: string, changes: [string, unknown][]) {
  for (const [property, value] of changes) {
    const res = await updateProperty(object, id, property, value);
    if (!res.ok) return res.error;
  }
  return null;
}

// ── Company ──

const COMPANY_FIELDS = ["name", "domain", "phone", "linkedinUrl", "industry", "employees", "country", "state", "city"] as const;
type CompanyForm = Record<(typeof COMPANY_FIELDS)[number], string>;

export function EditCompanyDialog({ company: c, onClose, onDone }: { company: QueueCompany; onClose: () => void; onDone: Done }) {
  const initial: CompanyForm = {
    name: c.name,
    domain: c.domain ?? "",
    phone: c.phone ?? "",
    linkedinUrl: c.linkedinUrl ?? "",
    industry: c.industry ?? "",
    employees: c.employees?.toString() ?? "",
    country: c.country ?? "",
    state: c.state ?? "",
    city: c.city ?? "",
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof CompanyForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const regions = regionsFor(f.country);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Correct ${c.name}`}>
        <form
          className="thin-scroll max-h-[70vh] space-y-3 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              if (!f.name.trim()) return setError("The company needs a name");
              // Country before state, so the state is checked against the new country
              const changes = COMPANY_FIELDS.filter((k) => f[k].trim() !== initial[k]).map((k): [string, unknown] => [k, f[k].trim() || null]);
              if (!changes.length) return onClose();
              const err = await saveFields("COMPANY", c.id, changes);
              if (err) return setError(err);
              onDone(`${c.name}: ${changes.length} field${changes.length === 1 ? "" : "s"} corrected`);
            });
          }}
        >
          <ErrorText error={error} />
          <div>
            <Label htmlFor="cc-name">Company name</Label>
            <Input id="cc-name" value={f.name} onChange={set("name")} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc-domain">Domain</Label>
              <Input id="cc-domain" value={f.domain} onChange={set("domain")} placeholder="company.com" />
            </div>
            <div>
              <Label htmlFor="cc-phone">Main phone</Label>
              <Input id="cc-phone" value={f.phone} onChange={set("phone")} placeholder="+1 813 555 0100" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc-industry">Industry</Label>
              <Select id="cc-industry" value={f.industry} onChange={set("industry")}>
                <option value="">--</option>
                {INDUSTRIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {f.industry && !INDUSTRIES.some((o) => o.value === f.industry) && <option value={f.industry}>{f.industry}</option>}
              </Select>
            </div>
            <div>
              <Label htmlFor="cc-emp">Employees</Label>
              <Input id="cc-emp" type="number" min={0} value={f.employees} onChange={set("employees")} />
            </div>
          </div>
          <div>
            <Label htmlFor="cc-li">LinkedIn company page</Label>
            <Input id="cc-li" value={f.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://www.linkedin.com/company/…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc-country">Country/Region</Label>
              <Select id="cc-country" value={f.country} onChange={(e) => setF((x) => ({ ...x, country: e.target.value, state: "" }))}>
                <option value="">--</option>
                {COUNTRIES.map((o) => (
                  <option key={o.code} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="cc-city">City</Label>
              <Input id="cc-city" value={f.city} onChange={set("city")} />
            </div>
          </div>
          {regions.length > 0 && (
            <div>
              <Label htmlFor="cc-state">State/Province</Label>
              <Select id="cc-state" value={f.state} onChange={set("state")}>
                <option value="">--</option>
                {regions.map((r) => (
                  <option key={r.code} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {f.country && <p className="text-[12px] text-ink-muted">Time zone: {timeZoneFor(f.country, f.state) ?? "--"} (set automatically)</p>}
          <Actions onClose={onClose} pending={pending} label="Save corrections" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Contact ──

const CONTACT_FIELDS = ["firstName", "lastName", "jobTitle", "email", "phone", "mobile"] as const;
type ContactForm = Record<(typeof CONTACT_FIELDS)[number], string> & { doNotCall: boolean };

export function ContactDialog({ companyId, contact, onClose, onDone }: { companyId: string; contact: Contact | null; onClose: () => void; onDone: Done }) {
  const initial: ContactForm = {
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    jobTitle: contact?.jobTitle ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    mobile: contact?.mobile ?? "",
    doNotCall: contact?.doNotCall ?? false,
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: (typeof CONTACT_FIELDS)[number]) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={contact ? `Correct ${contact.name}` : "Add a person"}>
        <form
          className="space-y-3 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              if (!contact) {
                const res = await createContact({ companyId, firstName: f.firstName, lastName: f.lastName, jobTitle: f.jobTitle, email: f.email, phone: f.phone });
                if (!res.ok) return setError(res.error);
                const rest: [string, unknown][] = [
                  ...(f.mobile.trim() ? [["mobile", f.mobile.trim()] as [string, unknown]] : []),
                  ...(f.doNotCall ? [["doNotCall", true] as [string, unknown]] : []),
                ];
                const err = await saveFields("CONTACT", res.data!.id, rest);
                if (err) return setError(err);
                return onDone(`Added ${[f.firstName, f.lastName].filter(Boolean).join(" ") || f.email}`);
              }
              const changes: [string, unknown][] = CONTACT_FIELDS.filter((k) => f[k].trim() !== initial[k]).map((k) => [k, f[k].trim() || null]);
              if (f.doNotCall !== initial.doNotCall) changes.push(["doNotCall", f.doNotCall]);
              if (!changes.length) return onClose();
              const err = await saveFields("CONTACT", contact.id, changes);
              if (err) return setError(err);
              onDone(`${contact.name}: ${changes.length} field${changes.length === 1 ? "" : "s"} corrected`);
            });
          }}
        >
          <ErrorText error={error} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ct-first">First name</Label>
              <Input id="ct-first" value={f.firstName} onChange={set("firstName")} autoFocus />
            </div>
            <div>
              <Label htmlFor="ct-last">Last name</Label>
              <Input id="ct-last" value={f.lastName} onChange={set("lastName")} />
            </div>
          </div>
          <div>
            <Label htmlFor="ct-title">Job title</Label>
            <Input id="ct-title" value={f.jobTitle} onChange={set("jobTitle")} />
          </div>
          <div>
            <Label htmlFor="ct-email">Email</Label>
            <Input id="ct-email" type="email" value={f.email} onChange={set("email")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ct-phone">Phone</Label>
              <Input id="ct-phone" value={f.phone} onChange={set("phone")} placeholder="+1 813 555 0100 ext. 204" />
            </div>
            <div>
              <Label htmlFor="ct-mobile">Mobile</Label>
              <Input id="ct-mobile" value={f.mobile} onChange={set("mobile")} />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-[var(--link)]" checked={f.doNotCall} onChange={(e) => setF((x) => ({ ...x, doNotCall: e.target.checked }))} />
            Do not call this person
          </label>
          <Actions onClose={onClose} pending={pending} label={contact ? "Save corrections" : "Add person"} disabled={!contact && !f.firstName.trim() && !f.lastName.trim() && !f.email.trim()} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Phone number / extension ──

export function NumberDialog({
  data,
  company: c,
  phone,
  focusExtension,
  onClose,
  onDone,
}: {
  data: QueueData;
  company: QueueCompany;
  phone: PhoneRow | null;
  focusExtension?: boolean;
  onClose: () => void;
  onDone: Done;
}) {
  const [f, setF] = useState<PhoneInput>(
    phone
      ? { number: phone.number, extension: phone.extension, type: phone.type, ivrPath: phone.ivrPath, status: phone.status, notes: phone.notes, contactId: phone.contactId }
      : { number: "", extension: "", type: "Main", ivrPath: "", status: "Unknown", notes: "", contactId: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PhoneInput>(k: K, v: PhoneInput[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={phone ? "Correct number" : "Add number"}>
        <form
          className="space-y-3 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              // A person's line may live on their contact record; save it on the company, which owns both kinds
              const res = await savePhoneNumber("COMPANY", c.id, phone?.id ?? null, f);
              if (!res.ok) return setError(res.error);
              onDone(phone ? "Number updated" : "Number added");
            });
          }}
        >
          <ErrorText error={error} />
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div>
              <Label htmlFor="qn-number">Number</Label>
              <Input id="qn-number" value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="+1 813 555 0100" autoFocus={!focusExtension} />
            </div>
            <div>
              <Label htmlFor="qn-ext">Extension</Label>
              <Input id="qn-ext" value={f.extension ?? ""} onChange={(e) => set("extension", e.target.value)} placeholder="204" autoFocus={focusExtension} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qn-type">Type</Label>
              <Select id="qn-type" value={f.type} onChange={(e) => set("type", e.target.value)}>
                {data.options.phoneType.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="qn-status">Status</Label>
              <Select id="qn-status" value={f.status} onChange={(e) => set("status", e.target.value)}>
                {data.options.phoneStatus.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="qn-ivr">IVR path</Label>
            <Input id="qn-ivr" value={f.ivrPath ?? ""} onChange={(e) => set("ivrPath", e.target.value)} placeholder="DBND 9, Sales 1, OPT 0" />
          </div>
          {c.contacts.length > 0 && (
            <div>
              <Label htmlFor="qn-contact">Whose line</Label>
              <Select id="qn-contact" value={f.contactId ?? ""} onChange={(e) => set("contactId", e.target.value || null)}>
                <option value="">Company line</option>
                {c.contacts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.jobTitle ? ` – ${x.jobTitle}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="qn-notes">Notes</Label>
            <Input id="qn-notes" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. Best before 10 AM, ask for Adam" />
          </div>
          <Actions onClose={onClose} pending={pending} label={phone ? "Save" : "Add number"} disabled={!f.number.trim()} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Research requests ──

export function ResearchRequestDialog({
  data,
  company: c,
  contactId: initialContact,
  onClose,
  onDone,
}: {
  data: QueueData;
  company: QueueCompany;
  contactId?: string | null;
  onClose: () => void;
  onDone: (message: string, held: boolean) => void;
}) {
  const [kind, setKind] = useState<string>(initialContact ? "Find direct number" : "Find decision maker");
  const [contactId, setContactId] = useState(initialContact ?? "");
  const [note, setNote] = useState("");
  const [hold, setHold] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Ask the research team">
        <form
          className="space-y-3 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await createResearchRequest({ companyId: c.id, contactId: contactId || null, campaignId: data.campaign.id, kind, note, hold });
              if (!res.ok) return setError(res.error);
              onDone(`${c.name}: sent to research (${kind})${hold ? ". It comes back to your queue when they answer" : ""}`, hold);
            });
          }}
        >
          <ErrorText error={error} />
          <p className="text-[13px] text-ink-muted">
            The request shows on the Research Queue. When a researcher sends it back, the result appears here and {c.name} moves to the top of the queue.
          </p>
          <div>
            <Label htmlFor="rr-kind">What do you need?</Label>
            <Select id="rr-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {RESEARCH_REQUEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </div>
          {c.contacts.length > 0 && (
            <div>
              <Label htmlFor="rr-contact">About</Label>
              <Select id="rr-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">The company</option>
                {c.contacts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.jobTitle ? ` – ${x.jobTitle}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="rr-note">Details for the researcher</Label>
            <textarea
              id="rr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Receptionist said the CTO left; find who runs engineering now"
              className="w-full rounded-[3px] border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-link focus:outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5 accent-[var(--link)]" checked={hold} onChange={(e) => setHold(e.target.checked)} />
            <span>
              Take it out of my queue until research is back
              <span className="block text-[12px] text-ink-subtle">It returns by itself after 14 days if nobody answers.</span>
            </span>
          </label>
          <Actions onClose={onClose} pending={pending} label="Send to research" disabled={kind === "Other" && !note.trim()} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Requests for this company: what's waiting on research, and results that came back. */
export function ResearchPanel({ company: c, onAsk, onChanged }: { company: QueueCompany; onAsk: () => void; onChanged: Done }) {
  const [pending, start] = useTransition();
  const [read, setRead] = useState<string[]>([]);
  if (!c.research.length) return null;
  const unseen = c.research.filter((r) => r.status === "Sent back" && !r.seen && !read.includes(r.id));
  return (
    <section className={cn("rounded-[6px] border p-3 text-[13px]", unseen.length ? "border-[#00bda5] bg-[#e5f8f6]" : "border-line")}>
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="size-4 text-[#6a78d1]" />
        <h2 className="flex-1 text-[14px] font-semibold">
          Research requests
          {unseen.length > 0 && <span className="ml-2 text-[12px] font-medium text-[#00806e]">{unseen.length} result{unseen.length === 1 ? "" : "s"} back</span>}
        </h2>
        {unseen.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markResearchSeen(unseen.map((r) => r.id));
                setRead((x) => [...x, ...unseen.map((r) => r.id)]);
              })
            }
          >
            Mark as read
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-link" onClick={onAsk}>
          New request
        </Button>
      </div>
      <ul className="space-y-2">
        {c.research.map((r) => (
          <li key={r.id} className="rounded-[4px] border border-line bg-surface px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {r.status === "Sent back" ? <CheckCircle2 className="size-4 text-[#00bda5]" /> : <Hourglass className="size-4 text-[#f5a623]" />}
              <span className="font-medium">{r.kind}</span>
              {r.contact && <span className="text-ink-muted">· {r.contact}</span>}
              <Pill label={r.status} color={REQUEST_STATUS_COLORS[r.status]} />
              {(r.status === "Open" || r.status === "In progress") && (
                <button
                  className="ml-auto text-[12px] text-link hover:underline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await cancelResearchRequest(r.id);
                      onChanged(res.ok ? `Cancelled the ${r.kind.toLowerCase()} request` : res.error);
                    })
                  }
                >
                  Cancel request
                </button>
              )}
            </div>
            {r.note && <div className="mt-0.5 text-[12px] text-ink-muted">Asked: {r.note}</div>}
            {r.result && <div className="mt-1 whitespace-pre-line rounded-[3px] bg-[#e5f8f6] px-2 py-1.5 text-ink">{r.result}</div>}
            <div className="mt-0.5 text-[12px] text-ink-subtle">
              {r.requestedBy ? `${r.requestedBy} asked` : "Asked"} {friendlyDateTime(r.createdAt)}
              {r.researcher ? ` · ${r.status === "Sent back" ? "answered" : "taken"} by ${r.researcher}` : ""}
              {r.resolvedAt && r.status === "Sent back" ? ` ${friendlyDateTime(r.resolvedAt)}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
