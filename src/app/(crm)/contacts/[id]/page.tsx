import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { RecordPage } from "@/components/record/record-page";
import { loadRecord } from "@/lib/crm/record-loader";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.contact.findUnique({ where: { id: (await params).id }, select: { firstName: true, lastName: true, email: true } });
  return { title: c ? fullName(c) : "Contact" };
}

export default async function ContactRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = await loadRecord("CONTACT", (await params).id, user.id);
  if (!data) notFound();
  return <RecordPage data={data} />;
}
