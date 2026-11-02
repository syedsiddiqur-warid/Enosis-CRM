import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { IntakeApiSettings } from "@/components/settings/intake-api";
import { getPropDefs } from "@/lib/crm/properties";
import { db } from "@/lib/db";

export const metadata = { title: "Intake API" };

export default async function IntakeApiPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [me, keys, users, companyDefs, jobs] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } }),
    db.apiKey.findMany({ orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: { select: { name: true } } }, orderBy: { name: "asc" } }),
    getPropDefs("COMPANY"),
    db.importJob.findMany({ where: { fileName: { startsWith: "API · " } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.email ?? null;
  return (
    <IntakeApiSettings
      endpoint={`${origin}/api/intake/companies`}
      isAdmin={me?.role?.name === "Admin"}
      leadSources={companyDefs.find((d) => d.name === "source")?.options ?? []}
      researchers={users.filter((u) => u.role?.name === "Researcher").map((u) => ({ id: u.id, name: u.name ?? u.email }))}
      keys={keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        source: k.source,
        researcherIds: k.researcherIds,
        addMissingOptions: k.addMissingOptions,
        createdBy: name(k.createdById),
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        useCount: k.useCount,
        revoked: !!k.revokedAt,
      }))}
      history={jobs.map((j) => ({ id: j.id, name: j.fileName.replace(/^API · /, ""), summary: (j.summary ?? {}) as Record<string, number> }))}
    />
  );
}
