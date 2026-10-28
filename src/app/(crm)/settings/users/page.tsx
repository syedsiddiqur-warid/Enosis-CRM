import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { UsersSettings } from "@/components/settings/users";
import { db } from "@/lib/db";

export const metadata = { title: "Settings · Users & teams" };

export default async function UsersSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [users, roles, teams, me] = await Promise.all([
    db.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, roleId: true } }),
    db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, description: true } }),
    db.team.findMany({ orderBy: { name: "asc" }, include: { members: { select: { userId: true, isManager: true } }, _count: { select: { layouts: true } } } }),
    db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } }),
  ]);
  return (
    <UsersSettings
      users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
      roles={roles}
      teams={teams.map((t) => ({ id: t.id, name: t.name, members: t.members, layouts: t._count.layouts }))}
      currentUserId={user.id}
      isAdmin={me?.role?.name === "Admin"}
      allowedDomain={process.env.AUTH_ALLOWED_DOMAIN ?? "enosisbd.com"}
    />
  );
}
