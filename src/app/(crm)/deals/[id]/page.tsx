import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { DealDetail } from "@/components/deals/deal-detail";
import { loadDeal } from "@/lib/crm/deal-loader";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await db.deal.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: d?.name ?? "Deal" };
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadDeal((await params).id, user.id);
  if (!data) notFound();
  return <DealDetail data={data} />;
}
