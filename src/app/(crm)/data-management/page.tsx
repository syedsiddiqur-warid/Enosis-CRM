import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { DataManagementPage } from "@/components/data-management/data-management-page";
import { loadBatchProgress, loadImportHistory } from "@/lib/crm/import-history";
import { inResearchWhere } from "@/lib/crm/in-research";
import { db } from "@/lib/db";

export const metadata = { title: "Data Management" };

export default async function DataManagement() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const [inResearch, addedWeek, readiedWeek, keys, jobs, batches] = await Promise.all([
    db.company.count({ where: { deletedAt: null, ...inResearchWhere } }),
    db.company.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
    db.company.count({ where: { deletedAt: null, readyAt: { gte: weekAgo } } }),
    db.apiKey.count({ where: { revokedAt: null } }),
    loadImportHistory(30),
    loadBatchProgress(15),
  ]);
  return <DataManagementPage stats={{ inResearch, addedWeek, readiedWeek, keys }} jobs={jobs} batches={batches} />;
}
