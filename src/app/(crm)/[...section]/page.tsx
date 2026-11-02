import { Construction } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

// Sections planned in later build-order steps. Each shows where it lands so nav never 404s.
const PLANNED: Record<string, { title: string; step: string }> = {
  notifications: { title: "Notifications", step: "Step 11 – Preferences and notifications" },
};

export default async function PlannedSection({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  const planned = PLANNED[section[0]];
  if (!planned) notFound();
  return (
    <div className="flex h-full items-center justify-center rounded-[6px] border border-line bg-surface">
      <div className="max-w-sm text-center">
        <Construction className="mx-auto mb-3 size-10 text-ink-subtle" strokeWidth={1.5} />
        <h1 className="mb-1 text-[18px] font-medium">{planned.title}</h1>
        <p className="mb-4 text-[13px] text-ink-muted">Not built yet. Planned for {planned.step}.</p>
        <Link href="/contacts" className="text-[13px] text-link hover:underline">
          Go to Contacts
        </Link>
      </div>
    </div>
  );
}
