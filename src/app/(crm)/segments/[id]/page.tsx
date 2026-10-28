import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { SegmentDetail } from "@/components/segments/segment-detail";
import { loadSegment, type SegmentSearchParams } from "@/lib/crm/segment-loader";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await db.segment.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: s?.name ?? "Segment" };
}

export default async function SegmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SegmentSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadSegment((await params).id, await searchParams, user.id);
  if (!data) notFound();
  return <SegmentDetail data={data} />;
}
