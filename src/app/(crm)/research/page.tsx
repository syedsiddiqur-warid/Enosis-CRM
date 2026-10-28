import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { ResearchBoard } from "@/components/research/research-board";
import { loadResearch, type ResearchSearchParams } from "@/lib/crm/research-loader";

export const metadata = { title: "Research Queue" };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<ResearchSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <ResearchBoard data={await loadResearch(user.id, await searchParams)} />;
}
