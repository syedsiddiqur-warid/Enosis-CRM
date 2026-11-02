// Companies still with the research team stay out of the Companies and Contacts tabs: they live in the Research Queue
// until they're ready to call. A company that has been ready once stays visible, even if sales later sends it back.
import type { Prisma } from "@prisma/client";
import { STAGE } from "./journey";
import type { CrmObject } from "./types";

export const RESEARCH_STAGES: string[] = [STAGE.sourced, STAGE.researching, STAGE.researched, STAGE.viable, STAGE.notViable];

export const inResearchWhere = { leadState: { in: RESEARCH_STAGES }, readyAt: null } satisfies Prisma.CompanyWhereInput;

/** The opposite, written out so companies without a stage (NULL) count as visible. */
export const outOfResearchWhere = { OR: [{ leadState: null }, { leadState: { notIn: RESEARCH_STAGES } }, { readyAt: { not: null } }] } satisfies Prisma.CompanyWhereInput;

export const isInResearch = (c: { leadState: string | null; readyAt: Date | string | null }) => !!c.leadState && RESEARCH_STAGES.includes(c.leadState) && !c.readyAt;

/** What the Companies / Contacts tabs show by default. Contacts show when any of their companies is out of research, or they have none. */
export function outOfResearch(object: CrmObject): Record<string, unknown> | null {
  if (object === "COMPANY") return outOfResearchWhere;
  if (object === "CONTACT")
    return { OR: [{ companies: { none: { company: { deletedAt: null } } } }, { companies: { some: { company: { deletedAt: null, ...outOfResearchWhere } } } }] } satisfies Prisma.ContactWhereInput;
  return null;
}
