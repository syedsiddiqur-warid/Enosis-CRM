import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { ImportSettings } from "@/components/settings/import-settings";
import { db } from "@/lib/db";

export const metadata = { title: "Settings · Import & templates" };

export default async function ImportSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [templates, jobs] = await Promise.all([
    db.importMappingTemplate.findMany({ orderBy: [{ objectType: "asc" }, { name: "asc" }] }),
    db.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true, email: true } } } }),
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
      jobs={jobs.map((j) => {
        const s = (j.summary ?? {}) as { totalRows?: number; created?: number; updated?: number; skipped?: number; errors?: number };
        const m = (j.mapping ?? {}) as { segmentId?: string | null };
        return {
          id: j.id,
          object: j.objectType as "CONTACT" | "COMPANY",
          fileName: j.fileName,
          status: j.status,
          by: j.user?.name ?? j.user?.email ?? null,
          at: j.createdAt.toISOString(),
          totalRows: s.totalRows ?? null,
          created: s.created ?? 0,
          updated: s.updated ?? 0,
          skipped: s.skipped ?? 0,
          errors: s.errors ?? 0,
          segmentId: m.segmentId ?? null,
        };
      })}
    />
  );
}
