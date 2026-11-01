import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { DealsPage } from "@/components/deals/deals-page";
import { loadDeals, type DealSearchParams } from "@/lib/crm/deal-loader";

export const metadata = { title: "Deals" };

export default async function Deals({ searchParams }: { searchParams: Promise<DealSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <DealsPage data={await loadDeals(user.id, await searchParams)} />;
}
