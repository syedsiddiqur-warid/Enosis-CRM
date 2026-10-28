import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { ListsSettings } from "@/components/settings/lists";
import type { PropOption } from "@/lib/crm/types";
import { db } from "@/lib/db";

export const metadata = { title: "Settings · Dropdown lists & follow-ups" };

export default async function ListsSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [lists, rules, me] = await Promise.all([
    db.optionList.findMany({ orderBy: { label: "asc" } }),
    db.followUpRule.findMany({ orderBy: { createdAt: "asc" } }),
    db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } }),
  ]);
  return (
    <ListsSettings
      lists={lists.map((l) => ({ key: l.key, label: l.label, options: (l.options as PropOption[] | null) ?? [] }))}
      rules={rules.map((r) => ({ id: r.id, callResult: r.callResult, taskTitle: r.taskTitle, taskType: r.taskType, dueInDays: r.dueInDays, isActive: r.isActive }))}
      canEdit={["Admin", "Manager"].includes(me?.role?.name ?? "")}
    />
  );
}
