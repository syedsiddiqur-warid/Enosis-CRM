// Parsers for the free text in Dynamics CRM lead exports. Pure functions, shared by the import review
// (browser) and the import itself (server), so what the review shows is exactly what gets imported.
//
//   Description:   "Targets>>" lines → contacts (every email and number, extension, DBND code, remarks),
//                  "Numbers>>" lines → company phone numbers with IVR paths, the header lines
//                  ("Types of service/apps:", "Career page:", "Notes:", "*Tech123*") → company fields
//   Caller Notes:  "10/23/2026: 01:56 PM: CRT: (325-223-9500 OPT) VM." and "T2T:" entries → call activities
//                  (entries that aren't calls become notes; text nothing understands is kept as a note)
import { toE164 } from "@/lib/utils";

export interface ParsedPhone {
  number: string;
  extension: string | null;
  /** Main / Direct / Mobile */
  type: string;
  /** Wrong / Disconnected when the text says so */
  status: string | null;
  /** Where it came from or what was said about it: "Seamless", "Leads to someone else" */
  note: string | null;
}

export interface ParsedTarget {
  key: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  /** First email; the rest are in `emails` */
  email: string | null;
  emails: string[];
  /** First usable direct number; all numbers are in `phones` */
  phone: string | null;
  phones: ParsedPhone[];
  /** Extension on the company's main line: "*208", "x 203" */
  extension: string | null;
  /** Dial-by-name directory: the code ("627"), or "No" when they aren't listed */
  dbnd: string | null;
  linkedinUrl: string | null;
  doNotCall: boolean;
  /** "(No longer)", "[no longer with the firm]" */
  noLonger: boolean;
  /** Everything else said about them: "EA - Mimi", "Not the right person", "DNC till 5/7/2025" */
  remarks: string[];
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
  /** The rest of the line: "Facebook", "added by Shafayet", "same as primary" */
  notes: string | null;
  raw: string;
}

export interface ParsedCall {
  key: string;
  /** Wall-clock "YYYY-MM-DDTHH:mm"; the import decides which time zone it's in */
  at: string;
  number: string | null;
  path: string | null;
  result: string | null;
  /** Text after the number, e.g. "VM." or "Spoke to Jordan Ellis…" */
  outcomeText: string;
  raw: string;
}

export interface ParsedNote {
  key: string;
  at: string | null;
  body: string;
}

/** Company fields from the Description's header lines */
export interface ParsedCompany {
  servicesOrApps: string | null;
  careerPageUrl: string | null;
  linkedinUrl: string | null;
  foundedYear: number | null;
  tags: string[];
}

export interface DynamicsParsed {
  targets: ParsedTarget[];
  numbers: ParsedNumber[];
  calls: ParsedCall[];
  notes: ParsedNote[];
  company: ParsedCompany;
  /** Phone menu notes written after "Targets>>": "DBND-* (3 FN), Sales-2" — set on the main number's IVR path */
  directory: string | null;
  /** Lines nothing understood; imported as one note so no information is lost */
  unparsed: string[];
}

const emptyCompany = (): ParsedCompany => ({ servicesOrApps: null, careerPageUrl: null, linkedinUrl: null, foundedYear: null, tags: [] });
export const EMPTY_PARSED: DynamicsParsed = { targets: [], numbers: [], calls: [], notes: [], company: emptyCompany(), directory: null, unparsed: [] };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const EMAIL_G = new RegExp(EMAIL.source, "gi");
const URL_G = /https?:\/\/[^\s,;)\]]+/gi;
const LINKEDIN_PERSON = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s,;|)\]]+/i;
const LINKEDIN_COMPANY = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[^\s,;|()\]]+/i;
/** North American and international numbers, with an optional extension */
const PHONE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*(\d{1,6}))?(?!\d)/i;
const PHONE_G = new RegExp(PHONE.source, "gi");
/** "Targets>>", "Targets>>>", "Numbers>", "Number>>", "Numbers:" at the start of a line */
const MARKER = /^\s*(targets?|numbers?|phones?)\s*(?:>{1,3}|:+)\s*/i;

const clean = (s: string) =>
  s
    .replace(/\*\*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:|\-–—•*^]+|[\s,;:|\-–—•*]+$/g, "")
    .trim();

const titleCase = (s: string) => (s === s.toUpperCase() && /[A-Z]{2}/.test(s) ? s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s);

function phoneParts(text: string): { number: string; extension: string | null; match: string } | null {
  const m = text.match(PHONE);
  if (!m) return null;
  const number = toE164(m[0].replace(/(?:x|ext\.?|extension)\s*\d+$/i, ""));
  return number ? { number, extension: m[2] ?? null, match: m[0] } : null;
}

const SOURCES = /\b(seamless(?:\.ai)?|lusha|zoom ?info|apollo(?:\.io)?|crunch ?base|facebook|linkedin|google|rocketreach|signal ?hire|contact ?out)\b/i;
const WRONG = /\b(wrong|invalid|not in service|leads? to someone else|not working|doesn'?t work)\b/i;
const DISCONNECTED = /\b(disconnect(?:ed)?|does not connect|doesn'?t connect|failed to establish)\b/i;

function phoneType(label: string, note: string) {
  const t = `${label} ${note}`;
  if (/\b(m|c|cell|mobile)\b/i.test(label) || /\b(mobile|cell)\b/i.test(note)) return "Mobile";
  if (/\b(o|office|main|hq|switchboard|corporate)\b/i.test(t)) return "Main";
  return "Direct";
}

// ── Description: sections ──

type Section = { kind: "targets" | "numbers" | "other"; lines: string[] };

/** Split a Description into its "Targets>>", "Numbers>>" sections and everything else. Blank lines are kept
 *  (as "") because they separate one person's block from the next. */
function sections(text: string): { list: Section[]; directory: string[] } {
  const list: Section[] = [];
  const directory: string[] = [];
  let current: Section = { kind: "other", lines: [] };
  list.push(current);
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    // Markers can also appear mid-line: "Targets>> A; B Numbers>> 813…"
    const parts = rawLine.split(/(?=\b(?:targets?|numbers?|phones?)\s*>{1,3})/i);
    for (let line of parts) {
      const m = line.match(MARKER);
      if (m && (m[0].includes(">") || current.kind !== "other" || /^\s*(numbers?|targets?)\s*:/i.test(line))) {
        const k = m[1].toLowerCase();
        current = { kind: k.startsWith("target") ? "targets" : "numbers", lines: [] };
        list.push(current);
        line = line.slice(m[0].length);
        // Text on the Targets>> line itself is usually the phone menu ("DBND-* (3 FN), Sales-2"),
        // but can also be the people themselves ("Targets>> Mark Ellis (CEO); Jane Roe - COO")
        if (current.kind === "targets" && clean(line)) {
          for (const e of line.split(/;|\s\|\s/)) {
            if (!clean(e)) continue;
            if (nameAndTitle(e.replace(EMAIL_G, " ").replace(PHONE_G, " ").replace(/\([^)]*\)?|\[[^\]]*\]?/g, " "))) current.lines.push(e.trim(), "");
            else directory.push(clean(e));
          }
          continue;
        }
      }
      const entries = current.kind === "other" ? [line] : line.split(/;|\s\|\s/);
      for (const e of entries) current.lines.push(clean(e) ? e.trim() : "");
    }
  }
  return { list, directory };
}

// ── Description: header lines → company fields ──

const FIELD = /^\s*(types? of services?(?:\s*\/\s*apps?)?|services?\s*\/\s*apps?(?:\s*\/\s*products?)?|industry focus|career(?: page)?|notes?(?:\s*\/\s*reasoning)?|founded(?: on)?|exemplify)\s*:+\s*(.*)$/i;

function parseHeader(lines: string[], out: DynamicsParsed) {
  const fields = new Map<string, string[]>();
  let key: string | null = null;
  for (const line of lines) {
    if (!clean(line)) continue;
    const tag = line.match(/^\s*\*\s*([^*]{2,30}?)\s*\*\s*$/);
    if (tag) {
      if (!out.company.tags.includes(tag[1])) out.company.tags.push(tag[1]);
      continue;
    }
    const f = line.match(FIELD);
    if (f) {
      const name = f[1].toLowerCase();
      key = name.startsWith("type") || name.startsWith("service") ? "services" : name.startsWith("industry") ? "industry" : name.startsWith("career") ? "career" : name.startsWith("note") ? "notes" : name.startsWith("found") ? "founded" : "other";
      if (!fields.has(key)) fields.set(key, []);
      if (clean(f[2])) fields.get(key)!.push(clean(f[2]));
      continue;
    }
    if (key) fields.get(key)!.push(clean(line));
    else out.unparsed.push(clean(line));
  }
  const all = [...fields.values()].flat().join(" ");
  out.company.linkedinUrl = all.match(LINKEDIN_COMPANY)?.[0].replace(/\(.*$/, "") ?? null;
  const services = (fields.get("services") ?? []).join(" ").replace(/[,.]+$/, "").trim();
  const industry = (fields.get("industry") ?? []).join(" ").trim();
  out.company.servicesOrApps = [services, industry && `Industry focus: ${industry}`].filter(Boolean).join("\n") || null;
  const career = (fields.get("career") ?? []).join(" ");
  out.company.careerPageUrl = career.match(URL_G)?.[0] ?? null;
  const careerRest = clean(career.replace(URL_G, " "));
  if (careerRest) out.unparsed.push(`Career page: ${careerRest}`);
  const year = (fields.get("founded") ?? []).join(" ").match(/\b(18|19|20)\d{2}\b/);
  if (year) out.company.foundedYear = Number(year[0]);
  const notes = clean([...(fields.get("notes") ?? []), ...(fields.get("other") ?? [])].join(" ").replace(LINKEDIN_COMPANY, " ").replace(/\(\s*\)/g, " "));
  if (notes) out.unparsed.push(`Notes: ${notes}`);
}

// ── Description: Targets>> ──

const TITLE_WORDS = /\b(ceo|cto|cio|coo|cfo|cmo|cpo|cso|vp|svp|evp|avp|vice president|director|head|manager|founder|co-?founder|owner|president|lead|architect|engineer|partner|chief|principal|officer|gm|chairman|board|developer|consultant|operations|engineering|product|sales|marketing|technology|technical|software|it|scientist|analyst|administrator|executive|specialist|coordinator|supervisor|controller|treasurer|secretary|member|advisor)\b/i;
/** Phone menu / directory lines that sit among the targets */
const IVR_LINE = /^\s*[*(]*\s*(press|dial|opt(ion)?|ext(ension)?|dbnd|english|french|spanish|sales|support|ts|cs|more options|hold|all directories|directory|main menu|menu|operator)\b/i;
const NOT_NAME = /^(the|with|for|not|no|a|an|my|of|and|or|added|target|targets|leads?|notes?|inc\.?|llc\.?|ltd\.?|corp\.?|company|www\..*|office|website|number|numbers|research|updated|unknown|n\/a|tbd)$/i;
const LABELLED =/^\s*[([]*\s*(d|o|m|c|ph|tel|cell|mobile|office|direct|dl|main|hq|ea)\s*[:.]\s*/i;

/** A line that continues the previous person: an email, a number, a labelled number or a remark. */
function isContinuation(line: string) {
  const t = line.trim();
  return EMAIL.test(t.split(/[\s,]/)[0] ?? "") || /^[\s([+]*\d/.test(t) || LABELLED.test(t) || /^[([]/.test(t);
}

/** The person's name at the start of a line, or null when the line isn't a person. */
function nameAndTitle(text: string): { name: string; title: string | null } | null {
  // Headings such as "Technical Leads:" and "Added for CRM Campaign::"
  if (/^[^,\-–—]*:\s*$/.test(text.trim()) || IVR_LINE.test(text)) return null;
  let t = clean(text.replace(/[()[\]]/g, " "));
  // "Jane Doe-Owner", "Sam Lee-Project Manager": a hyphen straight into the title
  t = t.replace(new RegExp(`^([\\p{L}.'’]+(?:\\s[\\p{L}.'’]+){0,3})-(?=(?:co[- ]?)?${TITLE_WORDS.source})`, "iu"), "$1 - ");
  if (!t || /\d/.test(t.split(/\s*[-–—]\s+|\s+[-–—]\s*|,/)[0])) return null;
  // "Jordan Ellis - Founder & President", "Priya Raman,Founder & CEO", "Sam Lee, Founder, CEO"
  const cut = t.search(/\s*[-–—]\s+|\s+[-–—]\s*|,/);
  let name = cut > 0 ? t.slice(0, cut) : t;
  let title: string | null = cut > 0 ? clean(t.slice(cut).replace(/^\s*[-–—,]\s*/, "")) : null;
  name = clean(name.replace(/^(mr|mrs|ms|dr|prof)\.?\s+/i, ""));
  const words = name.split(" ").filter((w) => w && !/^(male|female)$/i.test(w));
  // "CTO Adam Whitfield": the title comes first
  if (!title && words.length > 2 && TITLE_WORDS.test(words[0])) {
    const i = words.findIndex((w, j) => j > 0 && /^[A-Z][a-z]/.test(w) && !TITLE_WORDS.test(w));
    if (i > 0) {
      title = words.slice(0, i).join(" ");
      words.splice(0, i);
    }
  }
  // "Alex Kim Co-Founder", "Morgan Hale MALE Chief Executive Officer": the title follows without a separator
  if (!title && words.length > 2) {
    const j = words.findIndex((w, k) => k >= 2 && TITLE_WORDS.test(w));
    if (j > 0) {
      title = words.slice(j).join(" ");
      words.splice(j);
    }
  }
  if (!words.length || words.length > 5 || words.some((w) => !/^[\p{L}][\p{L}.'’-]*$/u.test(w))) return null;
  // Not a name: lower case only, or ordinary words ("No longer with the company", "My Notes", "Alpha Laboratories Inc.")
  if (words.every((w) => w === w.toLowerCase())) return null;
  if (words.some((w) => NOT_NAME.test(w))) return null;
  // A single word is only a person when a title follows ("Moon - President"), and never a title itself
  if (words.length === 1 && (!title || TITLE_WORDS.test(words[0]))) return null;
  if (words.every((w) => TITLE_WORDS.test(w))) return null;
  return { name: words.map(titleCase).join(" "), title: title ? clean(title.replace(/\s*,\s*,+/g, ",")) || null : null };
}

function parseTarget(lines: string[], i: number): ParsedTarget | null {
  const raw = lines.map((l) => l.trim()).join(" · ");
  let text = lines.join(", ");
  const remarks: string[] = [];

  // Emails and the person's LinkedIn
  const emails = [...new Set((text.match(EMAIL_G) ?? []).map((e) => e.toLowerCase().replace(/\.$/, "")))];
  text = text.replace(EMAIL_G, " ");
  const linkedinUrl = text.match(LINKEDIN_PERSON)?.[0] ?? null;
  text = text.replace(URL_G, " ");

  // Numbers with their label before ("D:", "O:") and what's said after ("(Seamless)", "wrong")
  const phones: ParsedPhone[] = [];
  const cuts: [number, number][] = [];
  for (const m of text.matchAll(PHONE_G)) {
    const ph = phoneParts(m[0]);
    if (!ph) continue;
    const start = m.index!;
    const end = start + m[0].length;
    const label = text.slice(Math.max(0, start - 14), start).match(/\b(d|o|m|c|ph|tel|cell|mobile|office|direct|dl|main)\s*[:.]\s*$|\b(office|direct|mobile|cell)\s+$/i);
    // What follows the number up to the next separator, including a bracketed remark
    const after = text.slice(end).match(/^[)\]]?\s*(?:\(([^()]*)\)|\[([^\]]*)\]|-\s*([^,(]*)|([a-z][a-z ]*))?/i);
    const said = clean([after?.[1], after?.[2], after?.[3], after?.[4]].filter(Boolean).join(" "));
    const status = WRONG.test(said) ? "Wrong" : DISCONNECTED.test(said) ? "Disconnected" : null;
    let note = clean(said.replace(/\b(direct|dir|office|main|mobile|cell)\b/gi, " "));
    // Remarks about the person that happen to follow their number
    if (/right person|no longer|decision maker|\bea\b/i.test(note)) {
      remarks.push(note);
      note = "";
    }
    phones.push({ number: ph.number, extension: ph.extension, type: phoneType(label?.[1] ?? label?.[2] ?? "", said), status, note: note || null });
    cuts.push([start - (label?.[0].length ?? 0), end + (after?.[0].length ?? 0)]);
  }
  for (const [s, e] of cuts.reverse()) text = `${text.slice(0, s)} ${text.slice(e)}`;

  // Extension on the main line ("*208", "x 203") and the dial-by-name directory ("DBND-627", "527 DBND", "x Dbnd")
  let extension: string | null = null;
  const ext = text.match(/(?:^|[\s(])(?:\*|x\s?|ext\.?\s*)(\d{2,5})\b/i);
  if (ext) {
    extension = ext[1];
    text = text.replace(ext[0], " ");
  }
  let dbnd: string | null = null;
  const code = text.match(/\bdbnd\s*[-:#]?\s*(\d{2,5})\b|\b(\d{2,5})\s*dbnd\b/i);
  if (code) {
    dbnd = code[1] ?? code[2];
    text = text.replace(code[0], " ");
  } else if (/\bx\s*dbnd\b|\bdbnd\s*(not listed|no match)|\bnot in dbnd\b/i.test(text)) {
    dbnd = "No";
    text = text.replace(/\bx\s*dbnd\b|\bdbnd\s*(not listed|no match)|\bnot in dbnd\b/gi, " ");
  }

  // Status remarks
  const noLonger = /\bno longer\b|\bleft (the )?(company|firm)\b/i.test(text);
  const dnc = text.match(/\bDNC\b(?:\s*(?:till|until)\s*([\d/.-]+))?/i);
  // "DNC till 5/7/2025" only blocks calls while that date is ahead
  const until = dnc?.[1]?.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  const dncActive = !!dnc && (!until || Date.UTC(Number(until[3]) < 100 ? 2000 + Number(until[3]) : Number(until[3]), Number(until[1]) - 1, Number(until[2])) > Date.now());
  if (dnc) remarks.push(dnc[1] ? `${dncActive ? "Do not call" : "Was do-not-call"} until ${dnc[1]}` : "Do not call");
  // Bracketed remarks: "(EA - MIMI)", "(Not the right person)", "[no longer with the firm]"
  text = text.replace(/\(([^()]*)\)|\[([^\]]*)\]/g, (_, a, b) => {
    const r = clean(String(a ?? b ?? "").replace(/\bDNC\b(?:\s*(?:till|until)\s*[\d/.-]+)?/gi, " ").replace(new RegExp(SOURCES.source, "gi"), " "));
    if (/[a-z]{2}/i.test(r)) remarks.push(r);
    return " ";
  });
  text = text.replace(/\bDNC\b(?:\s*(?:till|until)\s*[\d/.-]+)?/gi, " ").replace(/\(|\)|\[|\]/g, " ");
  // Free text after the title such as "- Leads to someone else"
  const tail = text.match(/\s[-–—]\s*((?:leads|not|no longer|left|wrong|retired)\b[^,]*)$/i);
  if (tail) {
    remarks.push(clean(tail[1]));
    text = text.slice(0, tail.index);
  }

  const nt = nameAndTitle(text.replace(/\bwww\.[^\s,]+/gi, " "));
  if (!nt) return null;
  const words = nt.name.split(" ");
  let title = nt.title;
  // "Ron Patterson (Co-Founder/ Head of Business Development)": the title in brackets
  const bracketTitle = !title ? remarks.findIndex((r) => TITLE_WORDS.test(r) && !/\b(no longer|not|added|ea)\b/i.test(r)) : -1;
  if (bracketTitle >= 0) title = remarks.splice(bracketTitle, 1)[0];
  // Bits of the title that are really remarks
  if (title) {
    // "CTO, >Busy", "COO, > Went to a different firm."
    const gt = title.indexOf(">");
    if (gt >= 0) {
      remarks.push(clean(title.slice(gt + 1)));
      title = title.slice(0, gt);
    }
    title = clean(title.replace(/\b(not the right person|full name not found|no longer[^,]*)\b/gi, (r) => (remarks.push(clean(r)), " ")));
    title = clean(title.replace(new RegExp(`[-–—]?\\s*${SOURCES.source}`, "gi"), " "));
    title = title.replace(/(,\s*)+/g, ", ").replace(/^,\s*|,\s*$/g, "") || null;
  }
  const direct = phones.find((p) => !p.status && p.type !== "Main") ?? phones.find((p) => !p.status) ?? null;
  return {
    key: `t${i}`,
    firstName: words[0] ?? null,
    lastName: words.length > 1 ? words.slice(1).join(" ") : null,
    jobTitle: title,
    email: emails[0] ?? null,
    emails,
    phone: direct?.number ?? null,
    phones,
    extension,
    dbnd,
    linkedinUrl,
    doNotCall: dncActive,
    noLonger: noLonger || remarks.some((r) => /\bno longer\b|went to a different (firm|company)|left the (company|firm)/i.test(r)),
    remarks: [...new Set(remarks.filter((r) => r && !/^(seamless|lusha|direct|office|main|mobile|cell|primary( number)?|new)\.?$/i.test(r)))],
    raw,
  };
}

const PHONE_TYPES: [RegExp, string][] = [
  [/\b(main|hq|head ?office|switchboard|corporate|o|office)\b/i, "Main"],
  [/\b(direct|dl|dir|d)\b/i, "Direct"],
  [/\b(mobile|cell|cellphone|m|c)\b/i, "Mobile"],
  [/\bsales\b/i, "Sales"],
  [/\b(operator|reception|front desk)\b/i, "Operator"],
];
const PHONE_STATUSES: [RegExp, string][] = [
  [WRONG, "Wrong"],
  [DISCONNECTED, "Disconnected"],
  [/\b(temp(orarily)? ?busy|busy)\b/i, "Temp Busy"],
];
/** IVR steps such as "DBND 9", "Sales 1", "OPT 0", "Press 2", "Ext 104" */
const IVR_STEP = /\b(dbnd|opt|option|press|sales|support|ext|extension|operator|dial|menu)\s*[-#*]?\s*\d{1,4}\b/gi;

function parseNumber(raw: string, i: number): ParsedNumber | null {
  const ph = phoneParts(raw);
  if (!ph) return null;
  const rest = raw.replace(ph.match, " ");
  const steps = rest.match(IVR_STEP) ?? [];
  const label = raw.slice(0, raw.indexOf(ph.match));
  const type = PHONE_TYPES.find(([re]) => re.test(label))?.[1] ?? PHONE_TYPES.find(([re]) => re.test(rest.replace(/\b[omcd]\b/gi, "")))?.[1] ?? "Main";
  const status = PHONE_STATUSES.find(([re]) => re.test(rest))?.[1] ?? null;
  // Words left after removing the IVR path and the label are notes; a short one may name the person ("Direct - Adam")
  let leftover = clean(rest.replace(IVR_STEP, " ").replace(/^\s*[([]*\s*(d|o|m|c|ph|tel|office|direct|main)\s*[:.]\s*/i, " ").replace(/[()[\]]/g, " "));
  leftover = leftover.replace(/^[-–—:,+\s]+|[-–—:,+\s]+$/g, "");
  const hint = clean(leftover.replace(/\b(number|no|line|phone|tel|ph|ivr|then|and|direct|main|office|mobile|cell|wrong|disconnected|temp|busy|sales|support)\b\.?/gi, " "));
  return {
    key: `n${i}`,
    number: ph.number,
    extension: ph.extension,
    type,
    ivrPath: steps.length ? steps.map((s) => clean(s).replace(/\s+/g, " ").replace(/^(\w)/, (c) => c.toUpperCase())).join(", ") : null,
    status,
    contactHint: hint && /^[A-Z][a-z]+(\s[A-Z][a-z]+)?$/.test(hint) ? hint : null,
    notes: leftover || null,
    raw,
  };
}

/** Group the Targets>> lines into people: a person's line plus the lines right after it that carry their
 *  emails and numbers. Directory lines go to `directory`; a number on its own line is a company number. */
function parseTargets(lines: string[], out: DynamicsParsed, directory: string[], companyNumbers: string[]) {
  let block: string[] | null = null;
  let gap = false;
  const flush = () => {
    if (!block) return;
    const t = parseTarget(block, out.targets.length);
    if (t) out.targets.push(t);
    else out.unparsed.push(block.join(" "));
    block = null;
  };
  for (const line of lines) {
    if (!clean(line)) {
      gap = true;
      continue;
    }
    if (block && !gap && isContinuation(line)) {
      block.push(line);
      continue;
    }
    if (nameAndTitle(line.replace(EMAIL_G, " ").replace(PHONE_G, " ").replace(URL_G, " ").replace(/\([^)]*\)?|\[[^\]]*\]?/g, " "))) {
      flush();
      block = [line];
    } else if (PHONE.test(line)) {
      flush();
      companyNumbers.push(line);
    } else if (IVR_LINE.test(line)) {
      flush();
      directory.push(clean(line));
    } else if (block && !gap) {
      block.push(line);
    } else {
      flush();
      out.unparsed.push(clean(line));
    }
    gap = false;
  }
  flush();
}

// ── Caller Notes ──

/** Start of an entry at the start of a line: "10/23/2026: 01:56 PM:" (time optional; "-" or ":" separators). */
const ENTRY = /^[ \t]*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[:\-,]?\s*(?:(\d{1,2})(?:[:.]|\s(?=\d{2}\s*[AP]\.?M))(\d{2})\s*([AP]\.?M\.?)?)?\s*[:\-]?\s*/gim;

const NOT_INTERESTED = /\b(not interested|no interest|n\/i|no need|not need|don'?t need|do not (?:have any |have a )?need|no requirement|not looking|in-?house|happy with|not the right person|not a fit|no budget|declined|not at this time|keep us on file|hung up)\b/i;

/** Call outcome keywords → outcome values (checked in order; only values that exist in the call outcome list are used). */
const RESULT_RULES: [RegExp, string][] = [
  [/\b(meeting|appointment|demo)\b.*\b(booked|set|scheduled|confirmed)\b|\bmeeting booked\b|\bmtg\b/i, "Meeting Booked"],
  [/\b(wrong (number|no|#)|invalid number|not in service|disconnected)\b/i, "Wrong Number"],
  [NOT_INTERESTED, "Connected – Not Interested"],
  [/\b(call ?back|callback|cb requested|call later|took (down )?(the )?(details|information) for a call ?back)\b/i, "Callback Requested"],
  [/\binterested\b|\bsend (more )?(info|details|an email|email)\b/i, "Connected – Interested"],
  [/\b(transferred to vm|trans(ferred)? (to )?vm|tvm)\b/i, "Transferred to VM"],
  [/\b(vm|voicemail|voice mail|left (a )?message|lvm)\b/i, "VM"],
  [/\b(gatekeeper|gk|receptionist|front desk|assistant|screened|operator said|ea\b)/i, "Gatekeeper"],
  [/\b(busy|engaged)\b/i, "Temp Busy"],
  [/\b(no answer|no ans|na|rang out|no response|no one picked|keeps ringing|failed to establish|unavailable|not available)\b/i, "No Answer"],
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
    // CRT = a call attempt, T2T = talked to the target
    const talked = /^\s*t2t\b/i.test(body);
    const isCall = talked || /^\s*crts?\b/i.test(body) || (PHONE.test(body) && RESULT_RULES.some(([re]) => re.test(body)));
    if (!isCall) {
      notes.push({ key: `o${notes.length}`, at, body: clean(body) });
      return;
    }
    let rest = body.replace(/^\s*(crts?|t2t)\s*[:\-]?\s*/i, "");
    // "(325-223-9500 OPT)" holds the number and path; the outcome follows
    const paren = rest.match(/\(([^)]*)\)/);
    const inner = paren && PHONE.test(paren[1]) ? paren[1] : null;
    if (inner) rest = rest.replace(paren![0], " ");
    const ph = phoneParts(inner ?? rest);
    if (ph && !inner) rest = rest.replace(ph.match, " ");
    const pathSource = inner ?? body;
    const path = PATH_RULES.find(([re]) => re.test(pathSource.replace(PHONE_G, " ")))?.[1] ?? null;
    const outcomeText = clean(rest.replace(PHONE_G, " ").replace(/^\s*(direct|dir|dl|opt|dbnd|transferred)\b[.:,]?/i, "").replace(/\s+\d{1,2}:\d{2}\s*[ap]m\s*:?$/i, ""));
    let result = RESULT_RULES.find(([re, v]) => outcomes.includes(v) && re.test(outcomeText))?.[1] ?? null;
    // Talked to the target but nothing says how it went
    if (talked && (!result || ["VM", "No Answer", "Gatekeeper", "Transferred to VM", "Temp Busy"].includes(result))) {
      result = outcomes.includes("Connected – Not Interested") && NOT_INTERESTED.test(outcomeText) ? "Connected – Not Interested" : outcomes.includes("Connected – Interested") ? "Connected – Interested" : result;
    }
    calls.push({ key: `c${calls.length}`, at, number: ph?.number ?? null, path, result, outcomeText, raw });
  });
  return { calls, notes, unparsed };
}

/** Parse a lead's Description and Caller Notes. `outcomes` are the call outcome values results may map to. */
export function parseDynamics(description: string | null, callerNotes: string | null, outcomes: string[]): DynamicsParsed {
  const out: DynamicsParsed = { targets: [], numbers: [], calls: [], notes: [], company: emptyCompany(), directory: null, unparsed: [] };
  if (description?.trim()) {
    const { list, directory } = sections(description);
    const numberLines: string[] = [];
    for (const s of list) {
      if (s.kind === "targets") parseTargets(s.lines, out, directory, numberLines);
      else if (s.kind === "numbers") numberLines.push(...s.lines.filter((l) => clean(l)));
      else if (s.lines.some((l) => clean(l))) {
        // Description text outside the sections: header fields, and sometimes caller-note style entries
        const text = s.lines.join("\n");
        if (/^[ \t]*\d{1,2}\/\d{1,2}\/\d{2,4}/m.test(text)) {
          const notes = parseCallerNotes(text, outcomes);
          out.calls.push(...notes.calls.map((c, i) => ({ ...c, key: `c${out.calls.length + i}` })));
          out.notes.push(...notes.notes.map((n, i) => ({ ...n, key: `o${out.notes.length + i}` })));
          parseHeader(notes.unparsed.join("\n").split("\n"), out);
        } else parseHeader(s.lines, out);
      }
    }
    for (const line of numberLines) {
      const n = parseNumber(line, out.numbers.length);
      if (n && !out.numbers.some((x) => x.number === n.number)) out.numbers.push(n);
      else if (!n) out.unparsed.push(clean(line));
    }
    if (directory.length) out.directory = directory.join("; ");
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
  return /\b(targets?|numbers?)\s*>{1,3}/i.test(text);
}
export function looksLikeCallerNotes(text: string) {
  return /\d{1,2}\/\d{1,2}\/\d{2,4}\s*[:\-]?\s*\d{1,2}:\d{2}\s*[AP]M\s*[:\-]?\s*(crt|t2t)/i.test(text);
}
