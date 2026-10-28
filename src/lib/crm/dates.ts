import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";

export const DEFAULT_TZ = "Asia/Dhaka";

export interface RelativePreset {
  key: string;
  label: string;
  help: string;
  /** Presets that need a number of days ("Last X days"). */
  takesDays?: boolean;
}

export const RELATIVE_PRESETS: RelativePreset[] = [
  { key: "today", label: "Today", help: "The current day" },
  { key: "yesterday", label: "Yesterday", help: "The previous 24 hour day" },
  { key: "tomorrow", label: "Tomorrow", help: "The next 24 hour day" },
  { key: "this_week", label: "This week", help: "The current calendar week (Mon–Sun)" },
  { key: "this_week_so_far", label: "This week so far", help: "Monday of this week up to now" },
  { key: "last_week", label: "Last week", help: "The previous calendar week" },
  { key: "next_week", label: "Next week", help: "The next calendar week" },
  { key: "this_month", label: "This month", help: "The current calendar month" },
  { key: "last_month", label: "Last month", help: "The previous calendar month" },
  { key: "next_month", label: "Next month", help: "The next calendar month" },
  { key: "this_quarter", label: "This quarter", help: "The current calendar quarter" },
  { key: "last_quarter", label: "Last quarter", help: "The previous calendar quarter" },
  { key: "this_year", label: "This year", help: "The current calendar year" },
  { key: "last_x_days", label: "Last X days", help: "The previous X days, including today", takesDays: true },
];

const WEEK = { weekStartsOn: 1 as const };

/** Resolve a relative preset to an absolute [from, to] range in the given time zone. */
export function resolveRelative(key: string, days = 7, tz = DEFAULT_TZ): [Date, Date] {
  const now = new TZDate(Date.now(), tz);
  switch (key) {
    case "today":
      return [startOfDay(now), endOfDay(now)];
    case "yesterday": {
      const d = subDays(now, 1);
      return [startOfDay(d), endOfDay(d)];
    }
    case "tomorrow": {
      const d = addDays(now, 1);
      return [startOfDay(d), endOfDay(d)];
    }
    case "this_week":
      return [startOfWeek(now, WEEK), endOfWeek(now, WEEK)];
    case "this_week_so_far":
      return [startOfWeek(now, WEEK), now];
    case "last_week": {
      const d = addWeeks(now, -1);
      return [startOfWeek(d, WEEK), endOfWeek(d, WEEK)];
    }
    case "next_week": {
      const d = addWeeks(now, 1);
      return [startOfWeek(d, WEEK), endOfWeek(d, WEEK)];
    }
    case "this_month":
      return [startOfMonth(now), endOfMonth(now)];
    case "last_month": {
      const d = addMonths(now, -1);
      return [startOfMonth(d), endOfMonth(d)];
    }
    case "next_month": {
      const d = addMonths(now, 1);
      return [startOfMonth(d), endOfMonth(d)];
    }
    case "this_quarter":
      return [startOfQuarter(now), endOfQuarter(now)];
    case "last_quarter": {
      const d = addQuarters(now, -1);
      return [startOfQuarter(d), endOfQuarter(d)];
    }
    case "this_year":
      return [startOfYear(now), endOfYear(now)];
    case "last_x_days":
      return [startOfDay(subDays(now, Math.max(1, days) - 1)), endOfDay(now)];
    default:
      return [startOfDay(now), endOfDay(now)];
  }
}

/** Start and end of the calendar day containing `iso` (a yyyy-mm-dd string) in the time zone. */
export function dayRange(iso: string, tz = DEFAULT_TZ): [Date, Date] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const day = new TZDate(y, m - 1, d, tz);
  return [startOfDay(day), endOfDay(day)];
}

export function formatDate(value: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!value) return "";
  const d = new Date(value);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!value) return "";
  const d = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** ISO → "yyyy-MM-ddTHH:mm" wall-clock time in `tz`, for <input type="datetime-local">. */
export function toLocalInput(value: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!value) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** "yyyy-MM-ddTHH:mm" wall-clock time in `tz` → ISO string. */
export function fromLocalInput(local: string, tz = DEFAULT_TZ) {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new TZDate(y, m - 1, d, h, mi, tz).toISOString();
}

/** "October 2026" in `tz`, for timeline month headings. */
export function monthLabel(value: Date | string, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", year: "numeric" }).format(new Date(value));
}

/** "Oct 28, 2026 at 3:42 PM" or "Today at 3:42 PM" */
export function friendlyDateTime(value: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!value) return "";
  const d = new Date(value);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  const today = new Date();
  if (day(d) === day(today)) return `Today at ${time}`;
  if (day(d) === day(addDays(today, -1))) return `Yesterday at ${time}`;
  if (day(d) === day(addDays(today, 1))) return `Tomorrow at ${time}`;
  return `${formatDate(d, tz)} at ${time}`;
}

/** "3:42 PM" in the record's own time zone, for calling. */
export function localTime(tz: string | null | undefined) {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date());
  } catch {
    return null;
  }
}
