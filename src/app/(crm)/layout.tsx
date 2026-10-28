import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import { TooltipProvider } from "@/components/ui/overlays";
import { db } from "@/lib/db";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const workspace = await db.workspaceSettings.findUnique({ where: { id: "workspace" } });

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <TooltipProvider>
      {workspace?.primaryColor && /^#[0-9a-f]{6}$/i.test(workspace.primaryColor) && <style>{`:root{--primary:${workspace.primaryColor}}`}</style>}
      <div className="flex h-screen flex-col">
        <TopBar user={session.user} workspaceName={workspace?.name ?? "Enosis CRM"} signOutAction={signOutAction} />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-auto p-3">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
