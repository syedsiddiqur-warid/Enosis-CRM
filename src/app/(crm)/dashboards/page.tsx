import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { DashboardsPage } from "@/components/dashboards/dashboards-page";
import { loadDashboard } from "@/lib/crm/dashboard-loader";
import type { DashboardSearchParams } from "@/lib/crm/dashboards";

export const metadata = { title: "Dashboards" };

export default async function Dashboards({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <DashboardsPage data={await loadDashboard(await searchParams)} />;
}
