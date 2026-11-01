import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { HandoverPage } from "@/components/handover/handover-page";
import type { HandoverSearchParams } from "@/lib/crm/handover";
import { loadHandover } from "@/lib/crm/handover-loader";
import type { PropOption } from "@/lib/crm/types";
import { db } from "@/lib/db";

export const metadata = { title: "Handover" };

export default async function Handover({ searchParams }: { searchParams: Promise<HandoverSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [data, types] = await Promise.all([loadHandover(await searchParams), db.optionList.findUnique({ where: { key: "campaignType" } })]);
  return <HandoverPage data={data} campaignTypes={((types?.options as PropOption[] | null) ?? []).filter((o) => !o.archived)} />;
}
