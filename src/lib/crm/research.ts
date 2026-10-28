// Research board columns. Shared by the loader (server) and the board (client).
export type ResearchColumn = "to_research" | "researching" | "researched" | "viable" | "callable" | "not_viable";

export const RESEARCH_COLUMNS: { id: ResearchColumn; label: string; help: string; color: string }[] = [
  { id: "to_research", label: "To research", help: "Sourced, not started", color: "#99afc4" },
  { id: "researching", label: "Researching", help: "In progress or needs more info", color: "#f5c26b" },
  { id: "researched", label: "Researched", help: "Done, viability not decided", color: "#00a4bd" },
  { id: "viable", label: "Viable", help: "Worth pursuing; check numbers and targets", color: "#6a78d1" },
  { id: "callable", label: "Callable", help: "Ready for a campaign", color: "#00bda5" },
  { id: "not_viable", label: "Not viable", help: "Last 30 days", color: "#f2545b" },
];

export function researchColumn(c: { researchStatus: string | null; properties: unknown }): ResearchColumn {
  const p = (c.properties ?? {}) as { viable?: string; callable?: string };
  if (p.viable === "No") return "not_viable";
  if (p.callable === "Yes") return "callable";
  if (p.viable === "Yes") return "viable";
  if (c.researchStatus === "Done") return "researched";
  if (c.researchStatus === "In progress" || c.researchStatus === "Needs more info") return "researching";
  return "to_research";
}
