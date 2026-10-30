// Import: shapes and column matching shared by the import page (client) and the import actions (server).
import type { CrmObject, PropDef } from "./types";

export type ImportObject = Extract<CrmObject, "CONTACT" | "COMPANY">;

/** Where a file column goes: "prop:<name>", "company:name" / "company:domain" / "companyprop:<name>" (contacts),
 *  "dyn:description" / "dyn:callerNotes" (Dynamics free text), "phones", "note" or "skip". */
export type ImportTarget = string;

export interface ImportTargetOption {
  value: ImportTarget;
  label: string;
  group: string;
  /** Allowed values / format hint for the format guide */
  hint?: string;
}

export interface ImportOptions {
  /** create: new records only (matches are skipped), update: matches only, upsert: both */
  mode: "upsert" | "create" | "update";
  ownerId: string | null;
  /** Companies (and contacts' new companies): lead source and batch for sourcing reports */
  source: string | null;
  batchNumber: string | null;
  /** Add dropdown values that aren't options yet instead of rejecting them */
  addMissingOptions: boolean;
  /** Put every created/updated record in a new static segment so the batch is easy to find */
  segmentName: string | null;
  /** Caller Notes timestamps: typed in the workspace zone (Asia/Dhaka) or in the company's own zone */
  dynamicsTimeZone: "workspace" | "company";
  /** Companies: research queue researchers. New companies (and matches without one) are spread evenly across them */
  researcherIds?: string[];
}

export const DYN_DESCRIPTION = "dyn:description";
export const DYN_CALLER_NOTES = "dyn:callerNotes";

/** Columns that are only stored on the company when importing contacts (Dynamics leads copy company data onto the person). */
export const COMPANY_PROP_PREFIX = "companyprop:";
/** Company imports: the lead person on the same row, created (or matched) and linked to the company. */
export const CONTACT_PROP_PREFIX = "contactprop:";

/** A Dynamics CRM "Lead Advanced Find View" export: one row per company, with its lead person, Description and Caller Notes. */
export function isDynamicsLeadExport(headers: string[]) {
  return headers.some((h) => /^\(do not modify\) lead$/i.test(h.trim()));
}

/** Where each column of a Dynamics lead export goes when it's imported as companies. Columns not listed are skipped. */
export const DYNAMICS_LEAD_COLUMNS: Record<string, ImportTarget> = {
  "(Do Not Modify) Lead": "prop:dynamicsLeadId",
  Owner: "prop:ownerId",
  Country: "prop:country",
  "State/Province": "prop:state",
  "First Name": `${CONTACT_PROP_PREFIX}firstName`,
  "Last Name": `${CONTACT_PROP_PREFIX}lastName`,
  "Job Title": `${CONTACT_PROP_PREFIX}jobTitle`,
  Email: `${CONTACT_PROP_PREFIX}email`,
  Industry: "prop:industry",
  "Employee Growth": "prop:growthTrend",
  "Investment Information": "prop:investmentInfo",
  "Founded On": "prop:foundedYear",
  "Technology Focus": "prop:technologies",
  "Company Name": "prop:name",
  Website: "prop:domain",
  LinkedIn: "prop:linkedinUrl",
  "Email Address 2": "prop:email",
  "No. of Employees": "prop:employees",
  "Offer Type": "prop:offerType",
  Source: "prop:source",
  Campaign: "prop:campaign",
  "Viable Status": "prop:viable",
  "Viable Checked By": "prop:viableCheckedBy",
  "Viable Checked On": "prop:viableCheckedOn",
  "Callable Status": "prop:callable",
  "Callable Checked By": "prop:callableCheckedBy",
  "Callable Checked On": "prop:callableCheckedOn",
  "Research Result": "prop:researchResult",
  "Reseach Type": "prop:researchType",
  "Research Type": "prop:researchType",
  "Research Notes": "note",
  "Researched By": "prop:researcherId",
  "Research Date": "prop:researchedAt",
  "Address 1: Telephone 1": "phones",
  "Address 1: Telephone 2": "phones",
  "Calling Outcome": "prop:callingOutcome",
  "Interest Level": "prop:interestLevel",
  "Outsourcing Experience": "prop:outsourcingExperience",
  Gatekeeper: "prop:gatekeeper",
  "CRT Count": "prop:crtCount",
  "Caller Notes": DYN_CALLER_NOTES,
  Description: DYN_DESCRIPTION,
  "Email Status": "prop:emailStatus",
  "Caller / Owner": "prop:callerId",
};

/** Dynamics wording → this CRM's option values */
export const OPTION_ALIASES: Record<string, Record<string, string>> = {
  callStatus: { "talked to target": "Reached Target", "couldnt reach target": "Never Reached Targets", "couldn't reach target": "Never Reached Targets" },
};

export interface ImportRowResult {
  row: number;
  action: "created" | "updated" | "skipped" | "error";
  id?: string;
  message?: string;
}

export interface ImportChunkResult {
  results: ImportRowResult[];
  /** Dropdown values that were added as new options */
  addedOptions: { property: string; value: string }[];
}

/** Properties the system maintains itself and imports can't set. */
export const NOT_IMPORTABLE = new Set(["createdAt", "leadStateAt", "lastEnrichedAt", "signalTypes", "lastSignalAt", "targetCount", "primaryCompany", "lastActivityAt"]);

/** Extra header spellings recognised when matching columns (Dynamics CRM and common tool exports). */
const ALIASES: Record<string, string[]> = {
  "prop:firstName": ["first name", "firstname", "given name"],
  "prop:lastName": ["last name", "lastname", "surname", "family name"],
  "prop:email": ["email", "email address", "e-mail", "work email", "business email"],
  "prop:phone": ["phone", "business phone", "work phone", "direct phone", "phone number", "company phone"],
  "prop:mobile": ["mobile", "mobile phone", "cell", "cell phone"],
  "prop:jobTitle": ["title", "job title", "position"],
  "prop:linkedinUrl": ["linkedin", "linkedin url", "person linkedin url", "linkedin profile", "company linkedin url"],
  "prop:name": ["company", "company name", "account name", "organization", "organization name"],
  "prop:domain": ["website", "domain", "company domain", "web site", "url", "company website"],
  "prop:employees": ["employees", "# employees", "employee count", "company size", "headcount", "no. of employees"],
  "prop:country": ["country", "country/region", "company country"],
  "prop:state": ["state", "state/province", "province", "region", "state/region", "company state"],
  "prop:city": ["city", "company city"],
  "prop:industry": ["industry"],
  "prop:description": ["description", "about", "short description"],
  "prop:ownerId": ["owner", "contact owner", "company owner", "assigned to"],
  "prop:timeZone": ["time zone", "timezone"],
  "company:name": ["company", "company name", "account name", "organization", "account"],
  "company:domain": ["company domain", "website", "company website", "domain"],
  phones: ["other phones", "phone numbers", "additional phones", "numbers"],
  note: ["notes", "note", "comments"],
  [DYN_CALLER_NOTES]: ["caller notes", "caller note", "call notes", "call history"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9#/]+/g, " ")
    .trim();

/** Best target for a column header, or "skip". Contacts' "Company" columns link companies instead of naming the contact. */
export function suggestTarget(header: string, targets: ImportTargetOption[], object: ImportObject, taken: Set<string>): ImportTarget {
  const h = norm(header);
  if (!h) return "skip";
  const free = (v: string) => !taken.has(v) || v === "phones" || v === "note";
  // Contacts: company-only columns ("Industry", "Employees") go to the company when the contact has no such property
  const companyMatch = (h2: string) =>
    object === "CONTACT"
      ? targets.find((t) => t.value.startsWith(COMPANY_PROP_PREFIX) && free(t.value) && norm(t.label.replace(/^Company › /, "")) === h2 && !targets.some((x) => x.value.startsWith("prop:") && norm(x.label) === h2))
      : undefined;
  const exact = targets.find((t) => free(t.value) && (norm(t.label) === h || t.value.replace(/^prop:/, "").toLowerCase() === h.replace(/ /g, "")));
  if (exact && !(object === "CONTACT" && exact.value === "prop:name")) return exact.value;
  for (const [target, names] of Object.entries(ALIASES)) {
    if (!names.map(norm).includes(h) || !free(target) || !targets.some((t) => t.value === target)) continue;
    return target;
  }
  const co = companyMatch(h);
  if (co) return co.value;
  for (const [target, names] of Object.entries(ALIASES)) {
    if (!target.startsWith("prop:") || !names.map(norm).includes(h)) continue;
    const alt = `${COMPANY_PROP_PREFIX}${target.slice(5)}`;
    if (free(alt) && targets.some((t) => t.value === alt)) return alt;
  }
  return "skip";
}

/** Columns the import page offers for an object. Contact imports can also fill company properties (`otherDefs` = company
 *  properties); company imports can create the row's lead person (`otherDefs` = contact properties). */
export function importTargets(object: ImportObject, defs: PropDef[], otherDefs: PropDef[] = []): ImportTargetOption[] {
  const importable = (d: PropDef) => !d.isVirtual && !NOT_IMPORTABLE.has(d.name);
  const props = defs.filter(importable).map((d) => ({ value: `prop:${d.name}`, label: d.label, group: d.groupLabel ?? "Properties", hint: formatHint(d) }));
  const extra: ImportTargetOption[] =
    object === "CONTACT"
      ? [
          { value: "company:name", label: "Company name (links or creates the company)", group: "Associations", hint: "Text" },
          { value: "company:domain", label: "Company domain (matches the company)", group: "Associations", hint: "acme.com or https://www.acme.com" },
        ]
      : [];
  // Contact imports fill the contact's company; company imports create the row's lead person
  const otherProps =
    object === "CONTACT"
      ? otherDefs
          .filter((d) => importable(d) && d.name !== "name" && d.name !== "domain")
          .map((d) => ({ value: `${COMPANY_PROP_PREFIX}${d.name}`, label: `Company › ${d.label}`, group: "Company (filled on the contact's company)", hint: formatHint(d) }))
      : otherDefs
          .filter((d) => importable(d) && !d.isReadOnly)
          .map((d) => ({ value: `${CONTACT_PROP_PREFIX}${d.name}`, label: `Lead person › ${d.label}`, group: "Lead person (a contact linked to the company)", hint: formatHint(d) }));
  return [
    ...extra,
    ...props,
    ...otherProps,
    {
      value: DYN_DESCRIPTION,
      label: "Dynamics Description (Targets>> and Numbers>>)",
      group: "Dynamics CRM",
      hint: "“Targets>>” lines become contacts, “Numbers>>” lines become phone numbers with IVR paths, other text is kept as a note",
    },
    {
      value: DYN_CALLER_NOTES,
      label: "Dynamics Caller Notes (call history)",
      group: "Dynamics CRM",
      hint: "Entries like “10/23/2026: 01:56 PM: CRT: (325-223-9500 OPT) VM.” become logged calls; other entries become notes",
    },
    { value: "phones", label: "Other phone numbers (become Phone number records)", group: "Other", hint: "Several numbers separated by ;" },
    { value: "note", label: "Note (added to the timeline)", group: "Other", hint: "Text" },
  ];
}

export function formatHint(d: PropDef): string {
  switch (d.type) {
    case "ENUM":
    case "RADIO":
      return `One of: ${(d.options ?? []).map((o) => o.label).join(", ")}`;
    case "MULTI_ENUM":
      return `Any of (separate with ;): ${(d.options ?? []).map((o) => o.label).join(", ")}`;
    case "DATE":
      return "Date: YYYY-MM-DD (or an Excel date)";
    case "DATETIME":
      return "Date and time: YYYY-MM-DD HH:mm, Asia/Dhaka (or an Excel date)";
    case "NUMBER":
      return d.format === "percent" ? "Number, e.g. 12.5 (percent)" : d.format === "currency" ? "Number, e.g. 2500000 (no currency sign needed)" : "Number";
    case "BOOLEAN":
      return "Yes / No";
    case "USER":
      return "User's email or full name";
    case "EMAIL":
      return "Email address";
    case "PHONE":
      return "Phone, e.g. +1 512 555 0100";
    case "URL":
      return "Web address";
    default:
      return "Text";
  }
}

/** Example values for the downloadable template's sample row. */
export function sampleValue(d: PropDef | undefined, target: ImportTarget, object: ImportObject): string {
  if (target === "company:name") return "Acme Analytics";
  if (target === "company:domain") return "acmeanalytics.com";
  if (target === "phones") return "+1 512 555 0101; +1 512 555 0102";
  if (target === "note") return "Imported from the Q1 list";
  if (!d) return "";
  const byName: Record<string, string> = {
    firstName: "Jordan",
    lastName: "Lee",
    email: "jordan.lee@acmeanalytics.com",
    phone: "+1 512 555 0100",
    mobile: "+1 512 555 0199",
    jobTitle: "CTO",
    name: "Acme Analytics",
    domain: "acmeanalytics.com",
    city: "Austin",
    state: "TX",
    country: "United States",
    employees: "240",
    foundedYear: "2012",
    timeZone: "America/Chicago",
    linkedinUrl: object === "CONTACT" ? "https://www.linkedin.com/in/jordanlee" : "https://www.linkedin.com/company/acme",
  };
  if (byName[d.name]) return byName[d.name];
  switch (d.type) {
    case "ENUM":
    case "RADIO":
      return d.options?.[0]?.label ?? "";
    case "MULTI_ENUM":
      return (d.options ?? [])
        .slice(0, 2)
        .map((o) => o.label)
        .join("; ");
    case "DATE":
      return "2026-11-15";
    case "DATETIME":
      return "2026-11-15 14:30";
    case "NUMBER":
      return "0";
    case "BOOLEAN":
      return "No";
    case "USER":
      return "name@enosisbd.com";
    case "URL":
      return "https://example.com";
    default:
      return "";
  }
}
