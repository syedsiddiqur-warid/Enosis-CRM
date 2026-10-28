import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { CallingQueue } from "@/components/prospecting/calling-queue";
import { loadQueue, type QueueSearchParams } from "@/lib/crm/calling-queue-loader";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.campaign.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: c ? `Calling: ${c.name}` : "Calling Queue" };
}

export default async function QueuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<QueueSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadQueue((await params).id, user.id, await searchParams);
  if (!data) notFound();
  return <CallingQueue data={data} />;
}
