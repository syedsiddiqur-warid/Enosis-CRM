import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { FollowUps } from "@/components/follow-ups/follow-ups";
import { loadFollowUps, type FollowSearchParams } from "@/lib/crm/follow-up-loader";
import { segmentSummaries } from "@/lib/crm/segments";
import type { PropOption } from "@/lib/crm/types";
import { db } from "@/lib/db";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<FollowSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [data, segments, types] = await Promise.all([
    loadFollowUps(user.id, await searchParams),
    segmentSummaries(user.id, "COMPANY"),
    db.optionList.findUnique({ where: { key: "campaignType" } }),
  ]);
  return <FollowUps data={data} segments={segments} campaignTypes={((types?.options as PropOption[] | null) ?? []).filter((o) => !o.archived)} />;
}
