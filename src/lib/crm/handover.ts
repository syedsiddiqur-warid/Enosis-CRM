// Handover: researched, ready-to-call companies waiting for sales. Shared by the loader (server) and the page (client).

export const HANDOVER_PAGE = 50;
/** Waiting longer than this is flagged: research's work goes stale if sales doesn't pick it up */
export const STALE_DAYS = 7;

export interface HandoverSearchParams {
  q?: string;
  industry?: string;
  country?: string;
  tz?: string;
  source?: string;
  batch?: string;
  researcher?: string;
  /** "7" / "30": waiting at least that many days */
  wait?: string;
  page?: string;
}

export const daysWaiting = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
