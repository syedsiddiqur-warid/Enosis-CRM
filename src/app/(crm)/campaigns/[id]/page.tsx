import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { loadCampaign, type CampaignSearchParams } from "@/lib/crm/campaign-loader";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.campaign.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: c?.name ?? "Campaign" };
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<CampaignSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadCampaign((await params).id, user.id, await searchParams);
  if (!data) notFound();
  return <CampaignDetail data={data} />;
}
