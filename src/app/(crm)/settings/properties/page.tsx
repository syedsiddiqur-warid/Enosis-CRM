import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { PropertiesSettings } from "@/components/settings/properties";
import { VIRTUAL_PROPERTIES } from "@/lib/crm/defaults";
import type { CrmObject, PropOption, PropType } from "@/lib/crm/types";
import { db } from "@/lib/db";

export const metadata = { title: "Settings · Properties" };

export default async function PropertiesSettingsPage({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const object: CrmObject = (await searchParams).object === "companies" ? "COMPANY" : "CONTACT";
  const [rows, groups, me] = await Promise.all([
    db.propertyDefinition.findMany({ where: { objectType: object }, include: { group: true }, orderBy: [{ group: { order: "asc" } }, { order: "asc" }] }),
    db.propertyGroup.findMany({ where: { objectType: object }, orderBy: { order: "asc" }, select: { name: true, label: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } }),
  ]);
  return (
    <PropertiesSettings
      key={object}
      object={object}
      groups={groups}
      canEdit={["Admin", "Manager"].includes(me?.role?.name ?? "")}
      properties={rows.map((r) => ({
        name: r.name,
        label: r.label,
        description: r.description,
        type: r.type as PropType,
        groupName: r.group?.name ?? null,
        groupLabel: r.group?.label ?? null,
        isBuiltIn: r.isBuiltIn,
        isReadOnly: r.isReadOnly,
        isVirtual: VIRTUAL_PROPERTIES[object].includes(r.name),
        options: (r.options as PropOption[] | null) ?? null,
        archived: !!r.archivedAt,
      }))}
    />
  );
}
