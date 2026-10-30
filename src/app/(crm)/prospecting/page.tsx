import { FlaskConical, PhoneCall } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { formatDate } from "@/lib/crm/dates";
import { loadQueueIndex } from "@/lib/crm/calling-queue-loader";

export const metadata = { title: "Calling Queue" };

export default async function ProspectingPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { campaigns, researchBack } = await loadQueueIndex(user.id);
  return (
    <div className="thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-6 py-5">
      <h1 className="text-[22px] font-medium">Calling Queue</h1>
      <p className="mt-1 max-w-[760px] text-[13px] text-ink-muted">
        Work through a campaign one company at a time: due follow-ups first, then companies not called yet, then retries. Each outcome you log updates the company&apos;s campaign outcome, lead journey
        and call history, and moves you to the next company.
      </p>

      {researchBack.length > 0 && (
        <section className="mt-5 rounded-[6px] border border-[#00bda5] bg-[#e5f8f6] p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-medium">
            <FlaskConical className="size-4 text-[#00806e]" /> Research is back for you ({researchBack.length})
          </h2>
          <p className="mb-2 text-[12px] text-ink-muted">These companies are at the top of their campaign queue. Open one to see the result and call.</p>
          <ul className="space-y-1.5">
            {researchBack.map((r) => (
              <li key={r.id} className="rounded-[4px] border border-line bg-surface px-3 py-2 text-[13px]">
                <Link href={r.campaignId ? `/prospecting/${r.campaignId}?caller=all&id=${r.companyId}` : `/companies/${r.companyId}`} className="font-medium text-link hover:underline">
                  {r.company}
                </Link>
                <span className="text-ink-muted"> · {r.kind}</span>
                {r.result && <div className="line-clamp-2 text-ink">{r.result}</div>}
                <div className="text-[12px] text-ink-subtle">
                  {r.researcher ? `${r.researcher}, ` : ""}
                  {r.resolvedAt ? formatDate(r.resolvedAt) : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((c) => (
          <section key={c.id} className="flex flex-col rounded-[6px] border border-line p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Link href={`/campaigns/${c.id}`} className="block truncate text-[15px] font-medium text-link hover:underline">
                  {c.name}
                </Link>
                <div className="text-[12px] text-ink-subtle">
                  {c.type}
                  {c.owner ? ` · ${c.owner}` : ""}
                  {c.endDate ? ` · ends ${formatDate(c.endDate)}` : ""}
                </div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["My queue", c.mineReady, c.mineDue ? `${c.mineDue} due now` : `${c.mine} assigned`],
                ["Unassigned", c.unassigned, "anyone can take"],
                ["Open in total", c.open, `${c.inHoursNow} in business hours`],
              ].map(([label, n, hint]) => (
                <div key={String(label)} className="rounded-[4px] bg-surface-muted px-2 py-2">
                  <dd className="text-[20px] font-medium tabular-nums">{n}</dd>
                  <dt className="text-[11px] text-ink-muted">{label}</dt>
                  <div className="text-[11px] text-ink-subtle">{hint}</div>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/prospecting/${c.id}?caller=me`}
                className="inline-flex h-8 items-center gap-1.5 rounded-[3px] bg-[#00806e] px-3 text-[13px] font-medium text-white hover:bg-[#006b5c] aria-disabled:pointer-events-none aria-disabled:opacity-50"
                aria-disabled={!c.mine}
              >
                <PhoneCall className="size-4" /> Start my calls
              </Link>
              {c.unassigned > 0 && (
                <Link href={`/prospecting/${c.id}?caller=unassigned`} className="inline-flex h-8 items-center rounded-[3px] border border-line-strong px-3 text-[13px] hover:bg-surface-hover">
                  Call unassigned
                </Link>
              )}
              <Link href={`/prospecting/${c.id}?caller=all`} className="inline-flex h-8 items-center rounded-[3px] px-2 text-[13px] text-link hover:underline">
                Everyone&apos;s queue
              </Link>
            </div>
          </section>
        ))}
      </div>
      {!campaigns.length && (
        <div className="py-16 text-center">
          <div className="mb-1 text-[16px] font-medium">No active campaigns</div>
          <div className="text-[13px] text-ink-muted">
            Launch a campaign on the{" "}
            <Link href="/campaigns" className="text-link hover:underline">
              Campaigns
            </Link>{" "}
            page to start calling.
          </div>
        </div>
      )}
    </div>
  );
}
