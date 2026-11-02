// Dashboard filters, shared by the loader (server) and the page (client).

export const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
] as const;

export interface DashboardSearchParams {
  tab?: string;
  period?: string;
  source?: string;
  campaign?: string;
}
