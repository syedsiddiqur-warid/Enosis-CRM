import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { SegmentsList } from "@/components/segments/segments-list";
import { loadQueryContext } from "@/lib/crm/context";
import { listSegments } from "@/lib/crm/segments";

export const metadata = { title: "Segments" };

export default async function SegmentsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const rows = await listSegments(user.id, await loadQueryContext(user.id));
  return <SegmentsList rows={rows} />;
}
