import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { GeneralSettings } from "@/components/settings/general";
import { db } from "@/lib/db";

export const metadata = { title: "Settings · General" };

export default async function GeneralSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [ws, me, counts] = await Promise.all([
    db.workspaceSettings.findUnique({ where: { id: "workspace" } }),
    db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } }),
    Promise.all([db.contact.count({ where: { deletedAt: null } }), db.company.count({ where: { deletedAt: null } }), db.user.count({ where: { isActive: true } }), db.campaign.count({ where: { status: "ACTIVE" } })]),
  ]);
  return (
    <GeneralSettings
      workspace={{ name: ws?.name ?? "Enosis CRM", defaultTimeZone: ws?.defaultTimeZone ?? "Asia/Dhaka", aiEnabled: ws?.aiEnabled ?? false }}
      isAdmin={me?.role?.name === "Admin"}
      counts={{ contacts: counts[0], companies: counts[1], users: counts[2], campaigns: counts[3] }}
      aiConfigured={!!process.env.ANTHROPIC_API_KEY}
    />
  );
}
