import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { IntegrationsSettings } from "@/components/settings/integrations";
import { PROVIDERS, integrationState, isConfigured } from "@/lib/crm/integrations";
import { db } from "@/lib/db";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [me, runs] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } }),
    db.enrichmentRun.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { company: { select: { id: true, name: true } } } }),
  ]);
  const providers = await Promise.all(
    PROVIDERS.map(async (p) => {
      const state = await integrationState(p.id);
      return {
        ...p,
        configured: isConfigured(p),
        enabled: state.enabled,
        settings: state.settings,
        lastRunAt: state.row?.lastRunAt?.toISOString() ?? null,
        lastError: state.row?.lastError ?? null,
      };
    }),
  );
  return (
    <IntegrationsSettings
      providers={providers}
      isAdmin={me?.role?.name === "Admin"}
      runs={runs.map((r) => ({
        id: r.id,
        provider: PROVIDERS.find((p) => p.id === r.provider)?.name ?? r.provider,
        company: r.company,
        status: r.status,
        changed: Object.keys((r.changes ?? {}) as object).length,
        error: r.error,
        at: r.createdAt.toISOString(),
      }))}
    />
  );
}
