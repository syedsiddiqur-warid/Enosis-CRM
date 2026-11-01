import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { LeadsPage } from "@/components/leads/leads-page";
import { loadLeads, type LeadSearchParams } from "@/lib/crm/lead-loader";

export const metadata = { title: "Leads" };

export default async function Leads({ searchParams }: { searchParams: Promise<LeadSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <LeadsPage data={await loadLeads(user.id, await searchParams)} />;
}
