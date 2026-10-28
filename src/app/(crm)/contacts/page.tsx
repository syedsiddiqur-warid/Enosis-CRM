import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { IndexPage } from "@/components/index/index-page";
import { loadIndex, type IndexSearchParams } from "@/lib/crm/index-loader";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<IndexSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadIndex("CONTACT", await searchParams, user.id);
  return <IndexPage data={data} />;
}
