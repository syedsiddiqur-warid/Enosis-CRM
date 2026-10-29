import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fullName(c: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  const n = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return n || c.email || "(No name)";
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** +18135550100 → +1 (813) 555-0100 */
const EXT = /\s*(?:ext\.?|x|;ext=)\s*(\d{1,8})\s*$/i;

/** "+18135550100 ext. 204" → { number: "+18135550100", extension: "204" } */
export function splitPhone(value: string | null | undefined): { number: string; extension: string | null } {
  const v = (value ?? "").trim();
  const m = v.match(EXT);
  return m ? { number: v.slice(0, m.index).trim(), extension: m[1] } : { number: v, extension: null };
}

export function formatPhone(e164: string | null | undefined) {
  if (!e164) return "";
  const { number, extension } = splitPhone(e164);
  const m = number.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return `${m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : number}${extension ? ` ext. ${extension}` : ""}`;
}

/** tel: link for a stored phone value; the extension is dialed after a pause. */
export function phoneHref(value: string) {
  const { number, extension } = splitPhone(value);
  return `tel:${number.replace(/[^\d+]/g, "")}${extension ? `,${extension}` : ""}`;
}

/** "+1 (813) 555-0100" → "+18135550100" (10-digit numbers are US). Null when it isn't a phone number. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+") && digits.length >= 8) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 7 ? digits : null;
}

export function formatNumber(value: unknown, format?: string | null) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  if (format === "percent") return `${n}%`;
  return new Intl.NumberFormat("en-US").format(n);
}

export function toBase64Url(obj: unknown) {
  const json = JSON.stringify(obj);
  const b64 = typeof window === "undefined" ? Buffer.from(json, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof window === "undefined" ? Buffer.from(b64, "base64").toString("utf8") : decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Domain-based logo placeholder: colored square with the first letter. */
export function colorFor(seed: string) {
  const palette = ["#00a4bd", "#ff7a59", "#6a78d1", "#00bda5", "#f5c26b", "#e3459b", "#516f90"];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
