import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { ChangePassword } from "@/components/account/change-password";
import { db } from "@/lib/db";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const me = await db.user.findUnique({ where: { id: user.id }, select: { email: true, passwordHash: true } });
  return <ChangePassword email={me?.email ?? user.email ?? ""} hasPassword={!!me?.passwordHash} />;
}
