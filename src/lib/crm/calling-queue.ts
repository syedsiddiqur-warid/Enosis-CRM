// Calling queue ordering and local-time helpers. Shared by the loader (server) and the queue page (client).
import { TZDate } from "@date-fns/tz";

/** Campaign outcomes that still need calling. Meeting booked / Not interested / Nurture / Disqualified / Completed drop out. */
export const OPEN_STATUSES = ["Queued", "In progress", "Connected"];

export type QueueBucket = "due" | "new" | "retry" | "scheduled";

export const BUCKET_LABEL: Record<QueueBucket, string> = {
  due: "Due now",
  new: "Not called yet",
  retry: "Call again",
  scheduled: "Scheduled later",
};

interface Orderable {
  attempts: number;
  nextActionAt: string | null;
  lastCallAt: string | null;
  addedAt: string;
}

/** Which part of the queue a company is in:
 *  due (next action has come) → new (never called) → retry (called, no next action set) → scheduled (next action later). */
export function queueBucket(m: Orderable, now = Date.now()): QueueBucket {
  if (m.nextActionAt) return new Date(m.nextActionAt).getTime() <= now ? "due" : "scheduled";
  return m.attempts === 0 ? "new" : "retry";
}

const BUCKET_ORDER: QueueBucket[] = ["due", "new", "retry", "scheduled"];
const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export function compareQueue(a: Orderable, b: Orderable, now = Date.now()) {
  const ba = queueBucket(a, now);
  const bb = queueBucket(b, now);
  if (ba !== bb) return BUCKET_ORDER.indexOf(ba) - BUCKET_ORDER.indexOf(bb);
  if (ba === "due" || ba === "scheduled") return t(a.nextActionAt) - t(b.nextActionAt);
  if (ba === "retry") return t(a.lastCallAt) - t(b.lastCallAt); // least recently called first
  return t(a.addedAt) - t(b.addedAt);
}

/** Local wall-clock hour (0–23) and weekday (0 = Sunday) in `tz`, or null for an unknown zone. */
export function localClock(tz: string | null | undefined, at = new Date()) {
  if (!tz) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(at).map((p) => [p.type, p.value]),
    );
    return { hour: Number(parts.hour), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
  } catch {
    return null;
  }
}

/** 9:30 their time on the first working day at least `days` days from now (default: their next working morning), as ISO. */
export function nextLocalMorning(tz: string | null | undefined, from = new Date(), days = 1) {
  const zone = tz || "Asia/Dhaka";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(from).map((p) => [p.type, p.value]),
  );
  for (let add = Math.max(1, days); add <= days + 7; add++) {
    const d = new TZDate(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + add, 9, 30, zone);
    if (d.getDay() >= 1 && d.getDay() <= 5) return new Date(d.getTime()).toISOString();
  }
  return new Date(from.getTime() + 864e5).toISOString();
}

/** Business hours (Mon–Fri, 9:00–17:00 local). Unknown time zones count as callable so they aren't hidden. */
export function inBusinessHours(tz: string | null | undefined, at = new Date()) {
  const c = localClock(tz, at);
  if (!c) return null;
  return c.weekday >= 1 && c.weekday <= 5 && c.hour >= 9 && c.hour < 17;
}
