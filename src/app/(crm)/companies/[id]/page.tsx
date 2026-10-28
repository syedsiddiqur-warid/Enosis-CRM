import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { RecordPage } from "@/components/record/record-page";
import { loadRecord } from "@/lib/crm/record-loader";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.company.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: c?.name ?? "Company" };
}

export default async function CompanyRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadRecord("COMPANY", (await params).id, user.id);
  if (!data) notFound();
  return <RecordPage data={data} />;
}
