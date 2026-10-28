// Parsers for the free text in Dynamics CRM lead exports. Pure functions, shared by the import review
// (browser) and the import itself (server), so what the review shows is exactly what gets imported.
//
//   Description:   "Targets>>" lines → contacts, "Numbers>>" lines → phone numbers with IVR paths
//   Caller Notes:  "10/23/2026: 01:56 PM: CRT: (325-223-9500 OPT) VM." entries → call activities
//                  (entries that aren't calls become notes; text nothing understands is kept as a note)
import { toE164 } from "@/lib/utils";

export interface ParsedTarget {
  key: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  raw: string;
}

export interface ParsedNumber {
  key: string;
  number: string;
  extension: string | null;
  type: string;
  ivrPath: string | null;
  status: string | null;
  /** Name mentioned on the line, matched to a target or existing contact on import */
  contactHint: string | null;
  raw: string;
}

export interface ParsedCall {
  key: string;
  /** Wall-clock "YYYY-MM-DDTHH:mm"; the import decides which time zone it's in */
  at: string;
  number: string | null;
  path: string | null;
  result: string | null;
  /** Text after the number, e.g. "VM." or "Gatekeeper asked to email" */
  outcomeText: string;
  raw: string;
}

export interface ParsedNote {
  key: string;
  at: string | null;
  body: string;
}

export interface DynamicsParsed {
  targets: ParsedTarget[];
  numbers: ParsedNumber[];
  calls: ParsedCall[];
  notes: ParsedNote[];
  /** Lines nothing understood; imported as one note so no information is lost */
  unparsed: string[];
}

export const EMPTY_PARSED: DynamicsParsed = { targets: [], numbers: [], calls: [], notes: [], unparsed: [] };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const LINKEDIN = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s,;|)]+/i;
/** North American and international numbers, with an optional extension */
const PHONE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*(\d{1,6}))?/i;
const PHONE_G = new RegExp(PHONE.source, "gi");
const MARKER = /^\s*(targets?|numbers?|phones?|notes?)\s*>>\s*/i;

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:|\-–—•*]+|[\s,;:|\-–—•*]+$/g, "")
    .trim();

function phoneParts(text: string): { number: string; extension: string | null; match: string } | null {
  const m = text.match(PHONE);
  if (!m) return null;
  const number = toE164(m[0].replace(/(?:x|ext\.?|extension)\s*\d+$/i, ""));
  return number ? { number, extension: m[2] ?? null, match: m[0] } : null;
}

// ── Description: sections ──

/** Split a Description into its "Targets>>", "Numbers>>" sections and everything else.
 *  A section runs until the next marker; entries are separated by new lines or ";". */
function sections(text: string) {
  const out: { kind: "targets" | "numbers" | "notes" | "other"; lines: string[] }[] = [];
  let current: (typeof out)[number] = { kind: "other", lines: [] };
  out.push(current);
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    let line = rawLine;
    // Markers can also appear mid-line: "Targets>> A; B Numbers>> 813…"
    const parts = line.split(/(?=\b(?:targets?|numbers?|phones?)\s*>>)/i);
    for (line of parts) {
      const m = line.match(MARKER);
      if (m) {
        const k = m[1].toLowerCase();
        current = { kind: k.startsWith("target") ? "targets" : k.startsWith("note") ? "notes" : "numbers", lines: [] };
        out.push(current);
        line = line.slice(m[0].length);
      }
      const entries = current.kind === "other" || current.kind === "notes" ? [line] : line.split(/;|\s\|\s/);
      for (const e of entries) if (clean(e)) current.lines.push(e.trim());
    }
  }
  return out;
}

const TITLE_WORDS = /\b(ceo|cto|cio|coo|cfo|cmo|vp|vice president|director|head|manager|founder|owner|president|lead|architect|engineer|partner|chief|principal|officer|svp|evp|gm)\b/i;

function parseTarget(raw: string, i: number): ParsedTarget | null {
  let text = raw;
  const email = text.match(EMAIL)?.[0]?.toLowerCase() ?? null;
  if (email) text = text.replace(EMAIL, " ");
  const linkedinUrl = text.match(LINKEDIN)?.[0] ?? null;
  if (linkedinUrl) text = text.replace(LINKEDIN, " ");
  const ph = phoneParts(text);
  if (ph) text = text.replace(ph.match, " ");
  // Title in parentheses, or after a separator: "Adam Whitfield (CTO)", "Adam Whitfield - CTO", "Adam Whitfield, CTO"
  let title: string | null = null;
  const paren = text.match(/\(([^)]+)\)/);
  if (paren) {
    title = clean(paren[1]);
    text = text.replace(paren[0], " ");
  }
  const chunks = text
    .split(/\s[-–—]\s|,|\s\/\s|\t/)
    .map(clean)
    .filter(Boolean);
  let name = chunks[0] ?? "";
  if (!title && chunks.length > 1) title = chunks.slice(1).join(", ");
  // "CTO Adam Whitfield" or a name that is really just a title
  if (!title && TITLE_WORDS.test(name) && name.split(" ").length > 2) {
    const words = name.split(" ");
    const cut = words.findIndex((w, j) => j > 0 && /^[A-Z][a-z]/.test(w) && !TITLE_WORDS.test(w));
    if (cut > 0) {
      title = words.slice(0, cut).join(" ");
      name = words.slice(cut).join(" ");
    }
  }
  name = name.replace(/^(mr|mrs|ms|dr)\.?\s+/i, "");
  const words = name.split(" ").filter(Boolean);
  if (!words.length && !email) return null;
  if (words.length > 5 && !email) return null; // a sentence, not a person
  return {
    key: `t${i}`,
    firstName: words[0] ?? null,
    lastName: words.length > 1 ? words.slice(1).join(" ") : null,
    jobTitle: title || null,
    email,
    phone: ph?.number ?? null,
    linkedinUrl,
    raw,
  };
}

const PHONE_TYPES: [RegExp, string][] = [
  [/\b(main|hq|head ?office|switchboard|corporate)\b/i, "Main"],
  [/\b(direct|dl|dir)\b/i, "Direct"],
  [/\b(mobile|cell|cellphone)\b/i, "Mobile"],
  [/\bsales\b/i, "Sales"],
  [/\b(operator|reception|front desk)\b/i, "Operator"],
];
const PHONE_STATUSES: [RegExp, string][] = [
  [/\b(wrong|invalid|not in service)\b/i, "Wrong"],
  [/\bdisconnected\b/i, "Disconnected"],
  [/\b(temp(orarily)? ?busy|busy)\b/i, "Temp Busy"],
];
/** IVR steps such as "DBND 9", "Sales 1", "OPT 0", "Press 2", "Ext 104" */
const IVR_STEP = /\b(dbnd|opt|option|press|sales|support|ext|extension|operator|dial|menu)\s*#?\s*\d{1,4}\b/gi;

function parseNumber(raw: string, i: number): ParsedNumber | null {
  const ph = phoneParts(raw);
  if (!ph) return null;
  const rest = raw.replace(ph.match, " ");
  const steps = rest.match(IVR_STEP) ?? [];
  const type = PHONE_TYPES.find(([re]) => re.test(rest))?.[1] ?? (steps.length ? "Main" : "Direct");
  const status = PHONE_STATUSES.find(([re]) => re.test(rest))?.[1] ?? null;
  // Words left after removing the IVR path, type and status may name the person ("Direct - Adam")
  let leftover = rest.replace(IVR_STEP, " ");
  for (const [re] of [...PHONE_TYPES, ...PHONE_STATUSES]) leftover = leftover.replace(re, " ");
  leftover = clean(leftover.replace(/[()[\]:,#]/g, " ").replace(/\b(number|no|line|phone|tel|ph|ivr|then|and)\b\.?/gi, " "));
  return {
    key: `n${i}`,
    number: ph.number,
    extension: ph.extension,
    type,
    ivrPath: steps.length ? steps.map((s) => clean(s).replace(/\s+/g, " ").replace(/^(\w)/, (c) => c.toUpperCase())).join(", ") : null,
    status,
    contactHint: leftover && /[a-z]/i.test(leftover) && leftover.split(" ").length <= 4 ? leftover : null,
    raw,
  };
}

// ── Caller Notes ──

/** Start of an entry: "10/23/2026: 01:56 PM:" (time optional; "-" or ":" separators). */
const ENTRY = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[:\-,]?\s*(?:(\d{1,2}):(\d{2})\s*([AP]\.?M\.?)?)?\s*[:\-]?\s*/gi;

/** Call outcome keywords → outcome values (checked in order; only values that exist in the call outcome list are used). */
const RESULT_RULES: [RegExp, string][] = [
  [/\b(meeting|appointment|demo)\b.*\b(booked|set|scheduled|confirmed)\b|\bmeeting booked\b|\bmtg\b/i, "Meeting Booked"],
  [/\b(wrong (number|no|#)|invalid number|not in service|disconnected)\b/i, "Wrong Number"],
  [/\b(not interested|no interest|n\/i)\b/i, "Connected – Not Interested"],
  [/\binterested\b/i, "Connected – Interested"],
  [/\b(call ?back|callback|cb requested|call later)\b/i, "Callback Requested"],
  [/\b(transferred to vm|trans(ferred)? (to )?vm|tvm)\b/i, "Transferred to VM"],
  [/\b(vm|voicemail|voice mail|left (a )?message|lvm)\b/i, "VM"],
  [/\b(gatekeeper|gk|receptionist|front desk|assistant|screened)\b/i, "Gatekeeper"],
  [/\b(busy|engaged)\b/i, "Temp Busy"],
  [/\b(no answer|no ans|na|rang out|no response|no one picked)\b/i, "No Answer"],
  [/\bconnected\b|\bspoke (to|with)\b|\btalked to\b/i, "Connected – Interested"],
];
const PATH_RULES: [RegExp, string][] = [
  [/\bopt\b|\boperator\b/i, "OPT"],
  [/\bdbnd\b|dial[- ]by[- ]name/i, "DBND"],
  [/\btransfer(red)?\b/i, "Transferred"],
  [/\bdirect\b|\bdir\b|\bdl\b/i, "Direct"],
];

function wallTime(mo: string, d: string, y: string, h?: string, mi?: string, ap?: string): string | null {
  let month = Number(mo);
  let day = Number(d);
  if (month > 12 && day <= 12) [month, day] = [day, month]; // a DD/MM date
  let year = Number(y);
  if (year < 100) year += 2000;
  let hour = h ? Number(h) : 12;
  const ampm = ap?.replace(/\./g, "").toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const minute = mi ? Number(mi) : 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}`;
}

function parseCallerNotes(text: string, outcomes: string[]) {
  const calls: ParsedCall[] = [];
  const notes: ParsedNote[] = [];
  const unparsed: string[] = [];
  const src = text.replace(/\r/g, "");
  const starts = [...src.matchAll(ENTRY)];
  const before = clean(src.slice(0, starts[0]?.index ?? src.length));
  if (before) unparsed.push(before);
  starts.forEach((m, i) => {
    const at = wallTime(m[1], m[2], m[3], m[4], m[5], m[6]);
    const body = src.slice(m.index! + m[0].length, starts[i + 1]?.index ?? src.length).trim();
    const raw = clean(src.slice(m.index!, starts[i + 1]?.index ?? src.length));
    if (!at) {
      // Looks like an entry but the date is impossible: keep the text, don't guess a time
      unparsed.push(raw);
      return;
    }
    if (!body) return;
    const isCall = /\bcrts?\b/i.test(body) || (PHONE.test(body) && RESULT_RULES.some(([re]) => re.test(body)));
    if (!isCall) {
      notes.push({ key: `o${notes.length}`, at, body: clean(body) });
      return;
    }
    let rest = body.replace(/^\s*crts?\s*[:\-]?\s*/i, "");
    // "(325-223-9500 OPT)" holds the number and path; the outcome follows
    const paren = rest.match(/\(([^)]*)\)/);
    const inner = paren && PHONE.test(paren[1]) ? paren[1] : null;
    if (inner) rest = rest.replace(paren![0], " ");
    const ph = phoneParts(inner ?? rest);
    if (ph && !inner) rest = rest.replace(ph.match, " ");
    const pathSource = inner ?? body;
    const path = PATH_RULES.find(([re]) => re.test(pathSource.replace(PHONE_G, " ")))?.[1] ?? null;
    const outcomeText = clean(rest.replace(/^\s*(direct|dir|dl|opt|dbnd|transferred)\b[.:,]?/i, ""));
    const result = RESULT_RULES.find(([re, v]) => outcomes.includes(v) && re.test(outcomeText))?.[1] ?? null;
    calls.push({ key: `c${calls.length}`, at, number: ph?.number ?? null, path, result, outcomeText, raw });
  });
  return { calls, notes, unparsed };
}

/** Parse a lead's Description and Caller Notes. `outcomes` are the call outcome values results may map to. */
export function parseDynamics(description: string | null, callerNotes: string | null, outcomes: string[]): DynamicsParsed {
  const out: DynamicsParsed = { targets: [], numbers: [], calls: [], notes: [], unparsed: [] };
  if (description?.trim()) {
    for (const s of sections(description)) {
      if (s.kind === "targets") {
        for (const line of s.lines) {
          const t = parseTarget(line, out.targets.length);
          if (t) out.targets.push(t);
          else out.unparsed.push(line);
        }
      } else if (s.kind === "numbers") {
        for (const line of s.lines) {
          const n = parseNumber(line, out.numbers.length);
          if (n && !out.numbers.some((x) => x.number === n.number)) out.numbers.push(n);
          else if (!n) out.unparsed.push(line);
        }
      } else if (s.lines.length) {
        // Description text outside the sections can itself hold caller-note style entries
        const notes = parseCallerNotes(s.lines.join("\n"), outcomes);
        out.calls.push(...notes.calls.map((c, i) => ({ ...c, key: `c${out.calls.length + i}` })));
        out.notes.push(...notes.notes.map((n, i) => ({ ...n, key: `o${out.notes.length + i}` })));
        out.unparsed.push(...notes.unparsed);
      }
    }
  }
  if (callerNotes?.trim()) {
    const notes = parseCallerNotes(callerNotes, outcomes);
    out.calls.push(...notes.calls.map((c, i) => ({ ...c, key: `c${out.calls.length + i}` })));
    out.notes.push(...notes.notes.map((n, i) => ({ ...n, key: `o${out.notes.length + i}` })));
    out.unparsed.push(...notes.unparsed);
  }
  return out;
}

/** Does this text look like a Dynamics Description / Caller Notes field? Used to suggest the mapping. */
export function looksLikeDescription(text: string) {
  return /\b(targets?|numbers?)\s*>>/i.test(text);
}
export function looksLikeCallerNotes(text: string) {
  return /\d{1,2}\/\d{1,2}\/\d{2,4}\s*[:\-]?\s*\d{1,2}:\d{2}\s*[AP]M\s*[:\-]?\s*crt/i.test(text);
}
