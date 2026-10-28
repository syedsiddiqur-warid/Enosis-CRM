import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { IndexPage } from "@/components/index/index-page";
import { loadIndex, type IndexSearchParams } from "@/lib/crm/index-loader";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<IndexSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadIndex("COMPANY", await searchParams, user.id);
  return <IndexPage data={data} />;
}
