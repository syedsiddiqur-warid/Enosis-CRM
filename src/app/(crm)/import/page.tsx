import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { ImportWizard } from "@/components/import/import-wizard";
import { importTargets, type ImportObject } from "@/lib/crm/import-shared";
import { getPropDefs } from "@/lib/crm/properties";
import type { PropOption } from "@/lib/crm/types";
import { db } from "@/lib/db";

export const metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const object: ImportObject = (await searchParams).object === "companies" ? "COMPANY" : "CONTACT";
  const [defs, companyDefs, contactDefs, users, templates, outcomes] = await Promise.all([
    getPropDefs(object),
    getPropDefs("COMPANY"),
    getPropDefs("CONTACT"),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.importMappingTemplate.findMany({ where: { objectType: object }, orderBy: { name: "asc" } }),
    db.optionList.findUnique({ where: { key: "callResult" } }),
  ]);
  return (
    <ImportWizard
      key={object}
      object={object}
      targets={importTargets(object, defs, object === "CONTACT" ? companyDefs : contactDefs)}
      callOutcomes={((outcomes?.options as PropOption[] | null) ?? []).filter((o) => !o.archived).map((o) => o.value)}
      users={users}
      currentUserId={user.id}
      leadSources={companyDefs.find((d) => d.name === "source")?.options ?? []}
      templates={templates.map((t) => ({ id: t.id, name: t.name, mapping: t.mapping as Record<string, string> }))}
    />
  );
}
