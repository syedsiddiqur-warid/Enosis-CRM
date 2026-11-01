// Deal options shared by the server and the client.

export const DEAL_TYPES = ["Staff Augmentation", "Project", "Product Dev"] as const;

export const LOST_REASONS = [
  "Went with a competitor",
  "Price too high",
  "No budget",
  "No decision / went quiet",
  "Timing",
  "Kept it in-house",
  "Not a fit",
  "Other",
] as const;

/** Close-date filters on the Deals page. */
export const CLOSE_FILTERS = [
  { value: "", label: "Any close date" },
  { value: "overdue", label: "Past close date" },
  { value: "month", label: "Closing this month" },
  { value: "quarter", label: "Closing this quarter" },
  { value: "none", label: "No close date" },
] as const;
