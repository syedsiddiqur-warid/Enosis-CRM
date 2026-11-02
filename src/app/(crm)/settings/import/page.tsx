import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { ImportSettings } from "@/components/settings/import-settings";
import { loadImportHistory } from "@/lib/crm/import-history";
import { db } from "@/lib/db";

export const metadata = { title: "Settings · Import & templates" };

export default async function ImportSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [templates, jobs] = await Promise.all([
    db.importMappingTemplate.findMany({ orderBy: [{ objectType: "asc" }, { name: "asc" }] }),
    loadImportHistory(50),
  ]);
  return (
    <ImportSettings
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        object: t.objectType as "CONTACT" | "COMPANY",
        mapped: Object.entries(t.mapping as Record<string, string>).filter(([, v]) => v !== "skip").length,
        columns: Object.keys(t.mapping as Record<string, string>).length,
        createdAt: t.createdAt.toISOString(),
      }))}
      jobs={jobs}
    />
  );
}
