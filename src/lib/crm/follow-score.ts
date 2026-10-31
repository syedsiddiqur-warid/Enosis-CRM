// Follow-up score: which called companies to chase, nurture, keep trying or drop, worked out from the calls
// logged on them and what callers reported after real conversations. Server-only.
import { db } from "@/lib/db";
import { FEEDBACK_TAGS, type FollowGroup } from "./follow-up";

const DAY = 864e5;
const POSITIVE = ["Connected – Interested", "Callback Requested", "Meeting Booked"];
const CONNECTED = /^connected/i;

type Call = {
  occurredAt: Date;
  callResult: string | null;
  feedbackRating: string | null;
  feedbackTags: string[];
  revisitAt: Date | null;
  ownerId: string | null;
};

const tagLabel = (key: string) => FEEDBACK_TAGS.find((t) => t.key === key)?.short ?? key;

/** Score one company's calling history (newest call first). */
export function scoreCalls(calls: Call[], company: { leadState: string | null; revisitAt: Date | null; interestLevel?: string | null }, now = Date.now()) {
  if (!calls.length) return null;
  const latest = calls[0];
  const conversations = calls.filter((c) => CONNECTED.test(c.callResult ?? "") || POSITIVE.includes(c.callResult ?? ""));
  const positives = calls.filter((c) => POSITIVE.includes(c.callResult ?? "") || c.feedbackRating === "Hot" || c.feedbackRating === "Warm");
  const rated = calls.find((c) => c.feedbackRating);
  const lastConversation = conversations[0] ?? null;
  // Everything callers ticked across conversations
  const tags = [...new Set(calls.flatMap((c) => c.feedbackTags))];

  let score = 0;
  if (rated) score += rated.feedbackRating === "Hot" ? 45 : rated.feedbackRating === "Warm" ? 30 : 5;
  // No caller feedback yet: the recorded interest level (e.g. from an imported CRM) stands in for it
  const interest = (company.interestLevel ?? "").toLowerCase();
  const notInterested = !rated && /^(none|not interested)$/.test(interest);
  if (!rated) score += interest === "high" || interest === "interested" ? 25 : interest === "medium" ? 12 : interest === "low" ? -10 : notInterested ? -20 : 0;
  const outcome = lastConversation?.callResult ?? null;
  if (outcome === "Meeting Booked") score += 35;
  else if (outcome === "Connected – Interested") score += 25;
  else if (outcome === "Callback Requested") score += 20;
  else if (outcome === "Connected – Not Interested") score -= 25;
  for (const t of tags) score += FEEDBACK_TAGS.find((x) => x.key === t)?.points ?? 0;
  score += Math.min(10, Math.max(0, positives.length - 1) * 5);
  // Interest fades: a good conversation long ago is worth less
  const lastGood = positives[0]?.occurredAt.getTime();
  if (lastGood) {
    const days = (now - lastGood) / DAY;
    if (days > 90) score -= 15;
    else if (days > 30) score -= 5;
  }
  // Lots of dialling and never a conversation
  if (!conversations.length && calls.length >= 4) score -= Math.min(15, (calls.length - 3) * 3);
  if (calls.slice(0, 3).every((c) => c.callResult === "Wrong Number")) score -= 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const future = (d: Date | null) => (d && d.getTime() > now ? d : null);
  const revisitAt = future(company.revisitAt) ?? future(latest.revisitAt);
  const notNow = tags.includes("not_now") && !!revisitAt;
  // A clear "no" on the latest conversation, with no warm rating or later good call
  const recentGood = !!lastGood && now - lastGood < 90 * DAY;
  const saidNo = outcome === "Connected – Not Interested" && rated?.feedbackRating !== "Warm" && rated?.feedbackRating !== "Hot" && !positives.some((p) => p.occurredAt > lastConversation!.occurredAt);
  const dropped = ["Disqualified", "Not viable"].includes(company.leadState ?? "") || saidNo || (notInterested && !recentGood);

  let group: FollowGroup;
  if (dropped) {
    group = "Drop";
    score = Math.min(score, 10);
  } else if (notNow || company.leadState === "Nurture") group = "Nurture";
  else if (!conversations.length) group = "Keep trying";
  // A recent good conversation is worth chasing even before callers rate it
  else if (score >= 50 || (POSITIVE.includes(outcome ?? "") && now - lastConversation!.occurredAt.getTime() < 30 * DAY)) group = "Chase now";
  else if (positives.length) group = "Nurture";
  else group = "Keep trying";

  // One line a caller can read at a glance
  const reason = [
    rated?.feedbackRating,
    ...tags.filter((t) => t !== "not_now").slice(0, 3).map(tagLabel),
    outcome ?? latest.callResult,
    revisitAt ? `revisit ${revisitAt.toISOString().slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { score, group, reason, callerId: (positives[0] ?? lastConversation ?? latest).ownerId, revisitAt };
}

const callSelect = { occurredAt: true, callResult: true, feedbackRating: true, feedbackTags: true, revisitAt: true, ownerId: true } as const;

/** Recalculate the follow-up score of these companies from their calls (company calls and calls to their people). */
export async function rescoreCompanies(companyIds: string[]) {
  for (const companyId of [...new Set(companyIds)]) {
    const [company, calls] = await Promise.all([
      db.company.findUnique({ where: { id: companyId }, select: { leadState: true, revisitAt: true, properties: true } }),
      db.activity.findMany({
        where: { type: "CALL", deletedAt: null, OR: [{ companies: { some: { companyId } } }, { contacts: { some: { contact: { companies: { some: { companyId } } } } } }] },
        select: callSelect,
        orderBy: { occurredAt: "desc" },
        take: 100,
      }),
    ]);
    if (!company) continue;
    const s = scoreCalls(calls, { ...company, interestLevel: (company.properties as { interestLevel?: string } | null)?.interestLevel ?? null });
    await db.company.update({
      where: { id: companyId },
      data: s
        ? { followScore: s.score, followGroup: s.group, followReason: s.reason.slice(0, 300), followCallerId: s.callerId, followUpdatedAt: new Date() }
        : { followScore: 0, followGroup: null, followReason: null, followCallerId: null, followUpdatedAt: new Date() },
    });
  }
}

/** Score every company that has calls but no score yet (first run, and after imports of call history). */
export async function rescoreUnscored(onProgress?: (done: number, total: number) => void) {
  const ids = (
    await db.company.findMany({
      where: { deletedAt: null, followUpdatedAt: null, OR: [{ activities: { some: { activity: { type: "CALL", deletedAt: null } } } }, { crtCount: { gt: 0 } }] },
      select: { id: true },
    })
  ).map((c) => c.id);
  for (let i = 0; i < ids.length; i += 50) {
    await rescoreCompanies(ids.slice(i, i + 50));
    onProgress?.(Math.min(ids.length, i + 50), ids.length);
  }
  return ids.length;
}
