import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { CampaignsList } from "@/components/campaigns/campaigns-list";
import { loadCampaigns } from "@/lib/crm/campaign-loader";
import { segmentSummaries } from "@/lib/crm/segments";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const showArchived = (await searchParams).archived === "1";
  const [data, segments] = await Promise.all([loadCampaigns(user.id, showArchived), segmentSummaries(user.id)]);
  return <CampaignsList data={data} segments={segments} showArchived={showArchived} />;
}
